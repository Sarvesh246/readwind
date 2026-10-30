import type { Page } from 'tesseract.js';
import { dominantSize, normalizePdfText, type PdfLine } from './pdf-layout';

/** Stretch a faint scan's luminance without binarizing away fine punctuation. */
export function enhanceOcrContrast(canvas: HTMLCanvasElement) {
  const ctx=canvas.getContext('2d', {willReadFrequently:true});
  if (!ctx) return;
  const image=ctx.getImageData(0,0,canvas.width,canvas.height), histogram=new Uint32Array(256);
  for(let i=0;i<image.data.length;i+=4) {
    const value=Math.round(.299*image.data[i]+.587*image.data[i+1]+.114*image.data[i+2]);
    image.data[i]=image.data[i+1]=image.data[i+2]=value;histogram[value]++;
  }
  const pixels=canvas.width*canvas.height;
  let count=0, low=0, high=255;
  for(let i=0;i<256;i++){count+=histogram[i];if(count>=pixels*.001){low=i;break;}}
  count=0;
  for(let i=255;i>=0;i--){count+=histogram[i];if(count>=pixels*.01){high=i;break;}}
  if(high-low>=15 && high-low<220) for(let i=0;i<image.data.length;i+=4) {
    const value=Math.max(0,Math.min(255,(image.data[i]-low)*255/(high-low)));
    image.data[i]=image.data[i+1]=image.data[i+2]=value;
  }
  ctx.putImageData(image,0,0);
}

export function ocrScore(data: Pick<Page, 'text' | 'confidence'>) {
  const text = data.text.trim();
  if (!text || !Number.isFinite(data.confidence)) return 0;
  const letters = (text.match(/[\p{L}\p{N}]/gu) || []).length;
  return Math.max(0, data.confidence) * Math.min(1, letters / Math.max(1, text.replace(/\s/g, '').length) / .65);
}

export function ocrLines(data: Page, width: number, height: number, rasterWidth: number, rasterHeight: number, page: number): PdfLine[] {
  const sx = width / rasterWidth, sy = height / rasterHeight;
  const lines = (data.blocks || []).flatMap(b => b.paragraphs.flatMap(p => p.lines.map((l,index) => {
    const heights=l.words?.filter(w=>w.text.trim().length>1).map(w=>({text:w.text,size:(w.bbox.y1-w.bbox.y0)*sy})) || [];
    const y = l.bbox.y1 * sy, size = heights.length ? dominantSize(heights) : Math.max(1, (l.bbox.y1-l.bbox.y0)*sy);
    return { text:normalizePdfText(l.text).trim(), x:l.bbox.x0*sx, endX:l.bbox.x1*sx, y, size, page, ocr:true, paragraphStart:index===0, header:y < height*.08 || l.bbox.y0*sy > height*.92 };
  }))).filter(l => l.text);
  const body=dominantSize(lines);
  return lines.map(l=>({...l,header:(l.y<height*.12 || l.y>height*.9) && l.size<=body*1.15}));
}
