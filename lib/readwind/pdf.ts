import type { Book, Section, PageMark } from "./types";
import { analyzePdfPage, dominantSize, importReport, type PdfPageReport } from './pdf-layout';
import { printedLabels, contentsChapters, interpolatePrintedLabels, type ContentsLink, pageHeading, matchesChapterTitle } from './chapters';
import { ocrLines, ocrScore, enhanceOcrContrast } from './ocr';
import {findPdfTables} from './pdf-tables';
import {normalizeStyledText,pdfFontStyle,type TextStyleRun} from './rich-text';
import {bookWordEvidence,joinPrintedLine,joinPageParagraphs} from './text-cleanup';
import {fidelityIssues,structuredBlocks,needsSourcePage,textLayerCheck,textLayerDisagrees,extractionLoss,ocrAddsContent} from './pdf-fidelity';
import {isContentsTitle,normalizePageLabel,printedPageToken} from './navigation-labels';
import {pageNotes,appendEndnotes} from './book-notes';
import {hasTextBands} from './auto-ocr';
export type ImportOptions = {
  removeHeaders: boolean;
  joinHyphens: boolean;
  ocr: boolean;
  password?: string;
  ocrLanguage?: string;
  verifyText?:boolean;
  verifyAllText?:boolean;
  textLayout?:'auto'|'verse'|'code'|'dialogue';
};
export type Imported = {
  book: Book;
  files: { id: string; blob: Blob }[];
  preview: Blob;
  removed: number;
  fixed: number;
  scanned: number;
  lowConfidence: number;
  figures: number;
  footnoteCount: number;
  pageText: string[];
};
type Line = {
  text: string;
  x: number;
  y: number;
  size: number;
  page: number;
  header: boolean;
  endX?: number;
  paragraphStart?: boolean;
  styles?:TextStyleRun[];
  monospace?:boolean;
};
export async function importPDF(
  file: File,
  options: ImportOptions,
  onProgress: (message: string, pct: number) => void,
  signal?: AbortSignal,
): Promise<Imported> {
  if (file.size > 20 * 1024 * 1024)
    throw new Error("Choose a PDF under 20 MB.");
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({
    data: await file.arrayBuffer(),
    cMapUrl: "/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/standard_fonts/",
    wasmUrl: "/pdf-wasm/",
    password: options.password,
    fontExtraProperties:true,
  });
  const abort = () => { void ocr?.terminate(); void task.destroy(); };
  signal?.addEventListener("abort", abort, { once: true });
  let ocr:
    | Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>>
    | undefined;
  try {
    if(signal?.aborted) throw new DOMException('Import cancelled','AbortError');
    const pdf = await task.promise;
    const labels = await pdf.getPageLabels().catch(()=>null),
      outline = await pdf.getOutline().catch(()=>null),
      metadata = await pdf.getMetadata().catch(() => null);
    const info = (metadata?.info || {}) as Record<string, string>;
    const all: Line[][] = [],
      files: { id: string; blob: Blob }[] = [],
      images = new Map<number, { id: string; y: number; aspectRatio:number; text?:string;fullPage?:boolean;sourcePdf?:boolean }[]>(),
      heights: number[] = [];
    const imageOnlyOpenings=new Set<number>();
    const preservedPages=new Set<number>();
    const verificationText=new Map<number,string>();
    const initialLinks=new Map<number,ContentsLink[]>();
    let verifiedNative=false;
    const pdfId=crypto.randomUUID();
    const reports: PdfPageReport[] = [];
    let scanned = 0,
      lowConfidence = 0,
      figureCount = 0;
    let preview: Blob | undefined;
    const raster = async (
      page: Awaited<ReturnType<typeof pdf.getPage>>,
      scale: number,
    ) => {
      const base = page.getViewport({scale:1});
      scale = Math.min(scale, Math.sqrt(12_000_000/(base.width*base.height)), 4096/Math.max(base.width,base.height));
      const v = page.getViewport({ scale }),
        canvas = document.createElement("canvas");
      canvas.width = Math.ceil(v.width);
      canvas.height = Math.ceil(v.height);
      const context = canvas.getContext("2d")!;
      await page.render({ canvasContext: context, canvas, viewport: v })
        .promise;
      return canvas;
    };
    const preserveSource=async(page:Awaited<ReturnType<typeof pdf.getPage>>,index:number,text:string)=>{
      let id=pdfId;const viewport=page.getViewport({scale:1});
      // Passwords are never persisted. Keep an unlocked rendering when reopening
      // the encrypted source would otherwise prevent inline source-page reading.
      if(options.password){const canvas=await raster(page,1.75),blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Could not preserve the unlocked page.')),'image/png'));id=crypto.randomUUID();files.push({id,blob});}
      figureCount-=images.get(index)?.length||0;figureCount++;
      images.set(index,[{id,y:0,aspectRatio:viewport.width/viewport.height,text,fullPage:true,sourcePdf:!options.password || undefined}]);preservedPages.add(index);imageOnlyOpenings.add(index);
      reports[index].sourcePreserved=true;
    };
    for (let p = 1; p <= pdf.numPages; p++) {
      if (signal?.aborted)
        throw new DOMException("Import cancelled", "AbortError");
      onProgress(
        `Reading page ${p} of ${pdf.numPages}`,
        Math.round((p / pdf.numPages) * 80),
      );
      const page = await pdf.getPage(p),
        v = page.getViewport({ scale: 1 }),
        content = await page.getTextContent().catch(()=>({items:[]}));
      heights.push(v.height);
      const items = content.items.filter(i=>"str" in i) as import("./pdf-layout").PdfTextItem[];
      const operators=await page.getOperatorList().catch(()=>null);
      const styledItems=items.map(item=>{
        try{const font=page.commonObjs.get(item.fontName!) as Parameters<typeof pdfFontStyle>[0];return {...item,...pdfFontStyle(font),monospace:/courier|mono|consolas|menlo|typewriter/i.test(font.name||'')};}catch{return item;}
      });
      const analysis = analyzePdfPage(styledItems as import("./pdf-layout").PdfTextItem[], v, p-1);
      analysis.report.issues.push(...fidelityIssues(analysis.lines,styledItems,v.width,v.height));
      if(!items.length && v.width>v.height*1.12)analysis.report.issues.push('scan-spread');
      reports.push(analysis.report);
      const lines: Line[] = analysis.lines;
      let detectionCanvas:HTMLCanvasElement|undefined;
      if (p === 1) {
        const canvas = await raster(page, 1);
        detectionCanvas=canvas;
        preview = await new Promise<Blob>((resolve) =>
          canvas.toBlob((b) => resolve(b!), "image/png"),
        );
      }
      let automaticOcr=false;
      if(!options.ocr && (analysis.report.characters<100 || analysis.report.issues.includes('text-mapping'))){
        automaticOcr=analysis.report.issues.includes('text-mapping');
        if(!automaticOcr){
          const source=detectionCanvas || await raster(page,Math.min(1,600/v.width,900/v.height));
          const probe=document.createElement('canvas'),scale=Math.min(1,500/source.width,800/source.height);probe.width=Math.max(1,Math.round(source.width*scale));probe.height=Math.max(1,Math.round(source.height*scale));
          const ctx=probe.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(source,0,0,probe.width,probe.height);
          const covered=lines.map(l=>({left:(l.x-2)*probe.width/v.width,right:((l.endX||l.x+l.text.length*l.size)+2)*probe.width/v.width,top:(l.y-l.size*1.3)*probe.height/v.height,bottom:(l.y+l.size*.35)*probe.height/v.height}));
          automaticOcr=hasTextBands(ctx.getImageData(0,0,probe.width,probe.height),covered);
        }
        if(automaticOcr){analysis.report.autoOcr=true;onProgress(`Page ${p} needs text recognition — enabling OCR automatically…`,Math.round((p/pdf.numPages)*80));}
      }
      const verifyNative=options.ocr && options.verifyText!==false && (analysis.report.issues.includes('suspect-text') || analysis.report.issues.includes('duplicate-text') || options.verifyAllText && analysis.report.characters>0 || analysis.report.characters>=400 && (!verifiedNative || p%25===0));
      if(verifyNative)verifiedNative=true;
      if (analysis.report.characters < 100 || analysis.report.issues.includes("text-mapping") || verifyNative) {
        if (!analysis.report.characters) scanned++;
        if (options.ocr || automaticOcr) {
        try {
        if (!ocr) {
          onProgress(
            "Loading text recognition…",
            Math.round((p / pdf.numPages) * 80),
          );
          const t = await import("tesseract.js");
          ocr = await t.createWorker(options.ocrLanguage || "eng", 1, {
            workerPath: "/ocr/worker.min.js",
            corePath: "/ocr/core/",
            langPath: "/ocr/lang/",
          });
        }
        onProgress(`Recognizing page ${p} of ${pdf.numPages}…`, Math.round((p / pdf.numPages) * 80));
        await ocr.setParameters({ tessedit_pageseg_mode: "3" as import("tesseract.js").PSM, preserve_interword_spaces: "1", user_defined_dpi: "300" });
        let canvas = await raster(page, 3);
        let result = await ocr.recognize(canvas, { rotateAuto:true }, { blocks:true, text:true });
        if (ocrScore(result.data) < 80) {
          const retryCanvas = await raster(page, 4);
          enhanceOcrContrast(retryCanvas);
          // A higher-resolution, single-column pass helps faint prose scans.
          await ocr.setParameters({ tessedit_pageseg_mode: (analysis.report.issues.includes('columns') || v.width>v.height*1.12 ? '3' : '6') as import("tesseract.js").PSM });
          const retry = await ocr.recognize(retryCanvas, { rotateAuto:true }, { blocks:true, text:true });
          if (ocrScore(retry.data) > ocrScore(result.data) + 3 && retry.data.text.trim().length >= result.data.text.trim().length * .8) { result = retry; canvas = retryCanvas; }
        }
        const recognized = ocrLines(result.data, v.width, v.height, canvas.width, canvas.height, p-1);
        const score = ocrScore(result.data);
        if(verifyNative)analysis.report.verification=textLayerCheck(lines.map(l=>l.text).join(' '),result.data.text,score);
        if(analysis.report.verification==='disagreed'){
          analysis.report.issues.push('ocr-mismatch');
          if(textLayerDisagrees(lines.map(l=>l.text).join(' '),result.data.text,score))verificationText.set(p-1,result.data.text);
          analysis.report.verification='disagreed';
        }
        analysis.report.ocrConfidence = score;
        if (score < 80 || !recognized.length) { lowConfidence++; analysis.report.issues.push("low-ocr"); }
        // Replace a broken/sparse text layer only when OCR actually recovers more text.
        if (recognized.length && (analysis.report.issues.includes("text-mapping") || ocrAddsContent(lines.map(l=>l.text).join(' '),result.data.text))) {
          if (!analysis.report.issues.includes("scanned")) { analysis.report.issues.push("scanned"); scanned++; }
          const nativeNumbers = analysis.report.issues.includes("text-mapping") ? [] : lines.filter(l => l.header && printedPageToken.test(normalizePageLabel(l.text)));
          // OCR often misses a small footer that the native layer already reads exactly.
          for (const number of nativeNumbers) {
            const duplicate = recognized.findIndex(l => l.header && Math.abs(l.y-number.y) < 24);
            if (duplicate >= 0) recognized.splice(duplicate, 1);
            const preserved = { ...number, endX:number.endX || number.x + number.size };
            if (number.y < v.height / 2) recognized.unshift(preserved); else recognized.push(preserved);
          }
          lines.splice(0, lines.length, ...recognized);
          analysis.report.characters = result.data.text.trim().length;
        }
        } catch(e) { if(signal?.aborted)throw e; analysis.report.issues.push("extraction-error"); }
      }
      }
      if(needsSourcePage(analysis.report.issues))await preserveSource(page,p-1,verificationText.get(p-1)||lines.map(l=>l.text).join('\n'));
      const imageOnlyOpening=!items.length && lines.reduce((n,l)=>n+l.text.length,0)<500;
      if (!preservedPages.has(p-1) && (items.length || imageOnlyOpening)) {
        try {
        const ops = operators || await page.getOperatorList(),
          stack: number[][] = [],
          regions: { x: number; y: number; w: number; h: number; lines?:import("./pdf-layout").PdfLine[]; text?:string }[] = [];
        let m = [1, 0, 0, 1, 0, 0];
        for (let oi = 0; oi < ops.fnArray.length; oi++) {
          const op = ops.fnArray[oi],
            args = ops.argsArray[oi];
          if (op === pdfjs.OPS.save) stack.push([...m]);
          else if (op === pdfjs.OPS.restore) m = stack.pop() || m;
          else if (op === pdfjs.OPS.transform) {
            const b = args as number[];
            m = [
              m[0] * b[0] + m[2] * b[1],
              m[1] * b[0] + m[3] * b[1],
              m[0] * b[2] + m[2] * b[3],
              m[1] * b[2] + m[3] * b[3],
              m[0] * b[4] + m[2] * b[5] + m[4],
              m[1] * b[4] + m[3] * b[5] + m[5],
            ];
          } else if (
            [
              pdfjs.OPS.paintImageXObject,
              pdfjs.OPS.paintInlineImageXObject,
            ].includes(op)
          ) {
            const corners = [
              [0, 0],
              [0, 1],
              [1, 0],
              [1, 1],
            ].map(([x, y]) =>
              v.convertToViewportPoint(
                m[0] * x + m[2] * y + m[4],
                m[1] * x + m[3] * y + m[5],
              ),
            );
            const xs = corners.map((c) => c[0]),
              ys = corners.map((c) => c[1]);
            // Clip the image box to the visible page. Content painted past the
            // page edge cannot be recovered from the page raster, and using the
            // unclipped box would stretch the visible part across the crop.
            const left = Math.max(0, Math.min(...xs)),
              top = Math.max(0, Math.min(...ys)),
              right = Math.min(v.width, Math.max(...xs)),
              bottom = Math.min(v.height, Math.max(...ys));
            const r = {
              x: left,
              y: top,
              w: Math.max(0, right - left),
              h: Math.max(0, bottom - top),
            };
            if (
              r.w > 24 &&
              r.h > 24 &&
              (imageOnlyOpening || !(r.w > v.width * 0.95 && r.h > v.height * 0.95))
            )
              {const labels=lines.filter(l=>l.x>=r.x-2 && (l.endX||l.x)<=r.x+r.w+2 && l.y>=r.y && l.y<=r.y+r.h);
               regions.push({...r,lines:labels as import("./pdf-layout").PdfLine[],text:labels.length?labels.map(l=>l.text).join("\n"):undefined});}
          }
        }
        const linkedIndex=(await page.getAnnotations().catch(()=>[])).filter(a=>a.dest).length>=3;
        if(!linkedIndex && !lines.some(l=>isContentsTitle(l.text)))regions.push(...findPdfTables(lines as import("./pdf-layout").PdfLine[]).filter(table=>!regions.some(r=>{
          const overlap=Math.max(0,Math.min(r.x+r.w,table.x+table.w)-Math.max(r.x,table.x))*Math.max(0,Math.min(r.y+r.h,table.y+table.h)-Math.max(r.y,table.y));
          return overlap>Math.min(r.w*r.h,table.w*table.h)*.5;
        })));
        if (regions.length) {
          analysis.report.issues.push("illustrated");
          const full = await raster(page, 1.5);
          for (const r of regions) {
            if (r.w < 1 || r.h < 1) continue;
            const crop = document.createElement("canvas");
            crop.width = Math.ceil(r.w * 1.5);
            crop.height = Math.ceil(r.h * 1.5);
            const sx = (r.x / v.width) * full.width,
              sy = (r.y / v.height) * full.height,
              sw = Math.min((r.w / v.width) * full.width, full.width - sx),
              sh = Math.min((r.h / v.height) * full.height, full.height - sy);
            crop
              .getContext("2d")!
              .drawImage(
                full,
                sx,
                sy,
                sw,
                sh,
                0,
                0,
                crop.width,
                crop.height,
              );
            const blob = await new Promise<Blob>((resolve) =>
                crop.toBlob((b) => resolve(b!), "image/png"),
              ),
              id = crypto.randomUUID();
            files.push({ id, blob });
            const previous = images.get(p - 1) || [];
            previous.push({ id, y:r.y, aspectRatio:r.w/r.h, text:r.text,fullPage:imageOnlyOpening || undefined });
            // Remove cell prose only after the faithful table image has been saved.
            if(imageOnlyOpening)imageOnlyOpenings.add(p-1);
            else for(const line of r.lines || []){const at=lines.indexOf(line);if(at>=0)lines.splice(at,1);}
            images.set(p - 1, previous);
            figureCount++;
          }
        }
        } catch(e) {
          if(signal?.aborted)throw e;
          analysis.report.issues.push("extraction-error");
        }
      }
      const links:ContentsLink[]=[];
      for(const annotation of await page.getAnnotations().catch(()=>[])){
        try{
          const dest=typeof annotation.dest==='string'?await pdf.getDestination(annotation.dest):annotation.dest;if(!Array.isArray(dest)||!annotation.rect)continue;
          const index=typeof dest[0]==='number'?dest[0]:await pdf.getPageIndex(dest[0]),a=v.convertToViewportPoint(annotation.rect[0],annotation.rect[1]),b=v.convertToViewportPoint(annotation.rect[2],annotation.rect[3]);
          if(index>=0 && index<pdf.numPages)links.push({index,top:Math.min(a[1],b[1]),bottom:Math.max(a[1],b[1]),left:Math.min(a[0],b[0]),right:Math.max(a[0],b[0])});
        }catch{/* Invalid destinations never establish chapter positions. */}
      }if(links.length)initialLinks.set(p-1,links);
      all.push(lines);
      page.cleanup();
      if (p % 3 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    onProgress("Finding chapters and cleaning the text…", 85);
    const frequency = new Map<string, Set<number>>();
    const normal = (s: string) =>
      s.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
    for (const lines of all)
      for (const line of lines.filter((l) => l.header)) {
        const key = normal(line.text);
        if (!frequency.has(key)) frequency.set(key, new Set());
        frequency.get(key)!.add(line.page);
      }
    const outlinePages = new Map<number, string>();
    const navigation:NonNullable<Book['navigation']>=[];
    const flattenOutline = (items: NonNullable<typeof outline>,level=0):{item:NonNullable<typeof outline>[number];level:number}[] => items.flatMap(item => [{item,level}, ...flattenOutline(item.items || [],Math.min(20,level+1))]);
    for (const {item,level} of flattenOutline(outline || [])) {
      try {
        const dest =
          typeof item.dest === "string"
            ? await pdf.getDestination(item.dest)
            : item.dest;
        if (Array.isArray(dest) && dest[0] !== undefined && dest[0] !== null) {
          const n =
            typeof dest[0] === "number"
              ? dest[0]
              : await pdf.getPageIndex(dest[0]);
          if (n >= 0 && n < pdf.numPages && !outlinePages.has(n)) outlinePages.set(n, item.title);
          if(n>=0 && n<pdf.numPages)navigation.push({title:item.title,level,pageIndex:n});
        }
      } catch {}
    }
    let pageLabels = printedLabels(all, labels, heights);
    const pageAliases:NonNullable<Book['pageAliases']>=all.flatMap((lines,index)=>{
      if(!reports[index].issues.includes('scan-spread') || (reports[index].ocrConfidence||0)<80)return [];
      const footers=lines.filter(l=>l.y>heights[index]*.85 && printedPageToken.test(normalizePageLabel(l.text)));
      const left=[...new Set(footers.filter(l=>l.x<reports[index].width/2).map(l=>normalizePageLabel(l.text)))],right=[...new Set(footers.filter(l=>l.x>=reports[index].width/2).map(l=>normalizePageLabel(l.text)))];
      return left.length===1 && right.length===1 && /^\d+$/.test(left[0]) && Number(right[0])===Number(left[0])+1?[{label:left[0],index},{label:right[0],index}]:[];
    });
    const contentsLinks=new Map([...initialLinks].map(([pi,links])=>[pi,links.map(link=>({...link,title:outlinePages.get(link.index)}))]));
    const toc = contentsChapters(all, pageLabels, contentsLinks, heights, outlinePages);
    pageLabels = interpolatePrintedLabels(pageLabels);
    const median = dominantSize(all.flat().filter(l=>!l.header));
    const wordEvidence=bookWordEvidence(all);
    const pageContinuations=new Set<number>();
    const sections: Section[] = [],
      marks: PageMark[] = [],
      pageText: string[] = [],
      footnotes = pageNotes(all as import("./pdf-layout").PdfLine[][],heights,median);
    let section: Section | undefined,
      removed = 0,
      fixed = 0;
    for(const [pi,lines] of all.entries()) {
      const pageLabel = pageLabels[pi];
      const kept = lines.filter((l) => {
        // Keep footnote text in reading order too: not every marker can be linked safely.
        const repeated =
          l.header && l.size <= median * 1.15 && /\p{L}/u.test(l.text) && !/^(chapter|part|book|section)\b/i.test(l.text) &&
          (frequency.get(normal(l.text))?.size || 0) >=
            Math.max(2, Math.ceil(pdf.numPages * 0.3));
        const numbered = l.header && l.size <= median && normalizePageLabel(l.text) === normalizePageLabel(pageLabel) && printedPageToken.test(normalizePageLabel(l.text));
        if (options.removeHeaders && (repeated || numbered)) {
          removed++;
          return false;
        }
        return true;
      });
      const detected = pageHeading(kept,median,heights[pi]);
      const heading = toc.contentsPages.has(pi) ? (toc.contentsPages.has(pi-1)?undefined:"Contents") : toc.chapters.get(pi) || outlinePages.get(pi) ||
        (!toc.contentsPages.size && !outlinePages.size?detected?.title:undefined);
      const headingLines=detected && heading && matchesChapterTitle(detected.title,heading)?detected.lines:[];
      if (!section || heading) {
        section = {
          id: crypto.randomUUID(),
          title: heading || "Beginning",
          heading: !!heading,
          level:navigation.find(n=>n.pageIndex===pi)?.level,
          blocks: [],
        };
        sections.push(section);
      }
      const blockAt = section.blocks.length;
      const first=kept.find(l=>!l.header),leftEdge=Math.min(...kept.filter(l=>!l.header && l.size>=median*.9).map(l=>l.x));
      if(!heading && first && !first.paragraphStart && first.x<=leftEdge+median*.35)pageContinuations.add(pi);
      marks.push({
        label: pageLabel,
        index: pi,
        at: { section: sections.length - 1, block: blockAt, offset: 0 },
      });
      let paragraphStyles:TextStyleRun[]=[];
      let paragraph = "",
        previous: Line | undefined;
      const flush = () => {
        if (paragraph.trim()) {
          const cleaned=normalizeStyledText(paragraph,paragraphStyles);
          section!.blocks.push({type:"p",text:cleaned.text,styles:cleaned.runs.length?cleaned.runs:undefined});
          paragraphStyles=[];
          paragraph = "";
        }
      };
      const entries = preservedPages.has(pi)?undefined:toc.entriesByPage.get(pi);
      const figures = (entries?.length && imageOnlyOpenings.has(pi)?[]:[...(images.get(pi) || [])]).sort((a, b) => a.y - b.y);
      if (entries?.length) {
        for (const entry of entries) {
          while(figures[0] && figures[0].y<entry.y){const figure=figures.shift()!;section.blocks.push({type:"figure",blobId:figure.id,aspectRatio:figure.aspectRatio,sourcePageIndex:pi,text:figure.text,fullPage:figure.fullPage,sourcePdf:figure.sourcePdf});}
          section.blocks.push({type:entry.group?"h":"p",text:entry.title+(entry.label?` · ${entry.label}`:''),styles:entry.styles,contentsEntry:!entry.description,targetPageIndex:entry.target});
        }
      }
      // Sparse image-only title pages retain their original typography instead of OCR artifacts.
      const structured=!entries?.length && !imageOnlyOpenings.has(pi)?structuredBlocks(kept.filter(l=>!headingLines.includes(l) && l.text!==heading) as import('./pdf-layout').PdfLine[],options.textLayout==='auto'?undefined:options.textLayout):undefined;
      if(structured?.length){
        // Mixed image/text pages keep source placement rather than detaching structured captions.
        if(figures.length){const source=await pdf.getPage(pi+1);await preserveSource(source,pi,kept.map(l=>l.text).join('\n'));source.cleanup();figures.splice(0,figures.length,...images.get(pi)!);}
        else{section.blocks.push(...structured);reports[pi].issues.push('structured-text');}
      }
      for (const line of entries?.length || imageOnlyOpenings.has(pi) || structured?.length ? [] : kept) {
        while (figures[0] && figures[0].y < line.y) {
          flush();
          const figure=figures.shift()!;
          section.blocks.push({type:"figure",blobId:figure.id,aspectRatio:figure.aspectRatio,sourcePageIndex:pi,text:figure.text,fullPage:figure.fullPage,sourcePdf:figure.sourcePdf});
        }
        if ((line.text === heading && line.y < heights[pi]*.5) || headingLines.some(l=>l===line)) {
          flush();
          continue;
        }
        if (
          previous &&
          (line.paragraphStart || line.y < previous.y || line.y - previous.y > median * 1.9 ||
            line.x - previous.x > median * .7)
        )
          flush();
        const bold=(line.styles||[]).filter(r=>r.bold).reduce((n,r)=>n+r.end-r.start,0)/Math.max(1,line.text.length);
        if(bold>.8 && line.text.length<150 && line.size>=median && (!previous || line.y-previous.y>median*1.5)){
          flush();const cleaned=normalizeStyledText(line.text,line.styles);section.blocks.push({type:"h",text:cleaned.text,styles:cleaned.runs});previous=undefined;continue;
        }
        const joined=joinPrintedLine(paragraph,line.text,options.joinHyphens,wordEvidence);
        const start=joined.text.length-line.text.length;
        if(joined.fixed)paragraphStyles=paragraphStyles.map(r=>({...r,end:Math.min(r.end,start)})).filter(r=>r.end>r.start);
        paragraphStyles.push(...(line.styles||[]).map(r=>({...r,start:r.start+start,end:r.end+start})));
        paragraph=joined.text;if(joined.fixed)fixed++;
        previous = line;
      }
      flush();
      for (const figure of figures)
        section.blocks.push({type:"figure",blobId:figure.id,aspectRatio:figure.aspectRatio,sourcePageIndex:pi,text:figure.text,fullPage:figure.fullPage,sourcePdf:figure.sourcePdf});
      if (section.blocks.length === blockAt)
        section.blocks.push({
          type: "p",
          text: "",
        });
      const sourceText=kept.map(l=>l.text).join('\n'),actual=section.blocks.slice(blockAt).map(b=>b.text||'').join('\n')+'\n'+(heading||'')+'\n'+headingLines.map(l=>l.text).join('\n');
      if(!preservedPages.has(pi) && extractionLoss(sourceText,actual)){
        reports[pi].issues.push('content-loss');const source=await pdf.getPage(pi+1);await preserveSource(source,pi,sourceText);source.cleanup();
        const figure=images.get(pi)![0];section.blocks.splice(blockAt,section.blocks.length-blockAt,{type:'figure',blobId:figure.id,aspectRatio:figure.aspectRatio,sourcePageIndex:pi,text:sourceText,fullPage:true,sourcePdf:figure.sourcePdf});
      }
      pageText.push(sourceText+"\n"+(images.get(pi)||[]).map(f=>f.text||" ").join("\n"));
    }
    appendEndnotes(sections,marks,footnotes);
    joinPageParagraphs(sections,marks,pageContinuations,options.joinHyphens,wordEvidence);
    files.push({
      id: pdfId,
      blob: new Blob([await file.arrayBuffer()], { type: "application/pdf" }),
    });
    const coverId = crypto.randomUUID();
    files.push({ id: coverId, blob: preview! });
    const title =
      info.Title?.trim() && !/untitled/i.test(info.Title)
        ? info.Title
        : file.name.replace(/\.pdf$/i, "").replace(/[_-]/g, " ");
    const report = importReport(reports);
    const automaticPages=reports.filter(p=>p.autoOcr).length;
    if(automaticPages)report.warnings.push(`OCR was enabled automatically for ${automaticPages} ${automaticPages===1?'page that needed':'pages that needed'} text recognition. Other text pages used fast extraction.`);
    if (toc.unresolved.length) report.warnings.push(`${toc.unresolved.length} contents entries could not be mapped confidently. Add or correct their chapters using the printed page labels.`);
    if (pageLabels.some(label => label.startsWith("PDF "))) report.warnings.push("Some printed page numbers are unknown. These pages use explicit PDF labels; set their printed labels in the preview before adding chapters by number.");
    const book: Book = {
      id: crypto.randomUUID(),
      title,
      author: info.Author?.trim() || "Unknown author",
      cover: {
        kind: "typeset",
        color: "#2F4A3A",
        fg: "#EFE6D2",
        blobId: coverId,
      },
      pdfCoverBlobId: coverId,
      sourcePdfBlobId: pdfId,
      readingMode: report.recommendedMode,
      importReport: report,
      addedAt: Date.now(),
      lastOpenedAt: Date.now(),
      printPageCount: pdf.numPages,
      navigation:navigation.length?navigation:undefined,
      pageAliases:pageAliases.length?pageAliases:undefined,
      sections,
      pageMarks: marks,
      footnotes,
    };
    const requiredFiles=new Set([pdfId,coverId,...sections.flatMap(s=>s.blocks.flatMap(b=>b.type==='figure'?[b.blobId]:[]))]);
    onProgress("Ready to review", 100);
    return {
      book,
      files:files.filter(f=>requiredFiles.has(f.id)),
      preview: preview!,
      removed,
      fixed,
      scanned,
      lowConfidence,
      figures: figureCount,
      footnoteCount: footnotes.length,
      pageText,
    };
  } finally {
    signal?.removeEventListener("abort", abort);
    await ocr?.terminate().catch(()=>{});
    await task.destroy();
  }
}
