import { unzipSync } from "fflate";
import type { Anchor, Block, Book, Section } from "./types";
import type { Imported } from "./pdf";
import { normalizeStyledTextWithOffsets } from "./rich-text";
import { validateFile } from "./file-validation";
export type ConversionReport = {
  version: 1;
  documents: number;
  sourceCharacters: number;
  outputCharacters: number;
  missingResources: string[];
  warnings: string[];
  passed: boolean;
  coverPath?: string;
  removals?: { kind: string; characters: number }[];
  relocatedNotices?: string[];
};
export type StructuredImport = Imported & {
  conversionReport: ConversionReport;
};
const decoder = new TextDecoder();
const MAX_SOURCE = 20 * 1024 * 1024,
  MAX_UNPACKED = 80 * 1024 * 1024;
export function resourcePath(base: string, href: string) {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(href) || href.includes("\\"))
    throw new Error("External book resources are not allowed.");
  const url = new URL(href, `https://book.invalid/${base}`);
  const path = decodeURIComponent(url.pathname.slice(1));
  if (
    path.split("/").some((p) => p === ".." || p === ".") ||
    path.includes("\\") ||
    path.includes("\0")
  )
    throw new Error("Unsafe book resource path.");
  return { path, fragment: decodeURIComponent(url.hash.slice(1)) };
}
export function unpackEpub(bytes: Uint8Array) {
  if (bytes.length > MAX_SOURCE) throw new Error("Choose an EPUB under 20 MB.");
  let total = 0,
    count = 0;
  const archive = unzipSync(bytes, {
    filter: (entry) => {
      if (
        ++count > 2000 ||
        entry.originalSize > MAX_SOURCE ||
        (total += entry.originalSize) > MAX_UNPACKED
      )
        throw new Error("EPUB exceeds safe extraction limits.");
      if (
        entry.name.startsWith("/") ||
        entry.name.includes("\\") ||
        entry.name.split("/").includes("..")
      )
        throw new Error("Unsafe EPUB archive path.");
      return true;
    },
  });
  if (
    decoder.decode(archive.mimetype || new Uint8Array()).trim() !==
    "application/epub+zip"
  )
    throw new Error("This ZIP is not an EPUB book.");
  if (archive["META-INF/encryption.xml"])
    throw new Error(
      "Encrypted EPUBs are not supported. Choose an unencrypted copy.",
    );
  return archive;
}
function parseXml(text: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error("External entities and document types are not supported.");
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror"))
    throw new Error("Damaged EPUB metadata.");
  return doc;
}
function elements(node: Document | Element, name: string) {
  return [...node.getElementsByTagNameNS("*", name)];
}
const tokens = (s: string) =>
  s.normalize("NFKC").match(/[\p{L}\p{N}]+/gu) || [];
function documentText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
  const text = [...node.childNodes].map(documentText).join("");
  return node instanceof Element &&
    /^(body|div|section|article|p|h[1-6]|li|td|th|tr|table|blockquote|pre|br|figure|figcaption|dt|dd)$/.test(
      node.localName,
    )
    ? ` ${text} `
    : text;
}
export function retainedText(source: string, output: string) {
  const counts = new Map<string, number>();
  for (const t of tokens(output)) counts.set(t, (counts.get(t) || 0) + 1);
  for (const t of tokens(source)) {
    const n = counts.get(t) || 0;
    if (!n) return false;
    counts.set(t, n - 1);
  }
  return true;
}
function safeDocument(
  text: string,
  removals: { kind: string; characters: number }[] = [],
  warnings: string[] = [],
) {
  if (/<!ENTITY/i.test(text)) throw new Error("Unsafe document entity.");
  const doc = new DOMParser().parseFromString(text, "text/html");
  doc
    .querySelectorAll(
      "script,style,iframe,object,embed,form,link,meta,base,nav",
    )
    .forEach((e) => {
      if (e.localName === "nav") {
        const check = e.cloneNode(true) as Element;
        check
          .querySelectorAll("a,h1,h2,h3,h4,h5,h6")
          .forEach((a) => a.remove());
        if (tokens(check.textContent || "").length > 40)
          warnings.push(
            "Navigation contains substantial prose; source review is required.",
          );
      }
      removals.push({
        kind: e.localName,
        characters: (e.textContent || "").length,
      });
      e.remove();
    });
  for (const el of doc.querySelectorAll("*"))
    for (const a of [...el.attributes])
      if (
        a.name.startsWith("on") ||
        ["style", "srcset", "hidden", "aria-hidden"].includes(a.name) ||
        (["href", "src", "xlink:href"].includes(a.name) &&
          /^(?:javascript|data):/i.test(a.value))
      )
        el.removeAttribute(a.name);
  return doc;
}
async function imageBlob(bytes: Uint8Array, type: string) {
  if (type === "image/svg+xml") {
    const doc = parseXml(decoder.decode(bytes));
    if (
      doc.querySelector("script,foreignObject,iframe,image,use") ||
      [...doc.querySelectorAll("*")].some((e) =>
        [...e.attributes].some(
          (a) =>
            a.name.startsWith("on") ||
            /url\(|https?:|data:|javascript:/i.test(a.value),
        ),
      )
    )
      throw new Error("Unsupported active SVG image.");
    const url = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(doc)], { type }),
    );
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(1800, img.naturalWidth || 800);
      canvas.height = Math.min(2400, img.naturalHeight || 1200);
      canvas
        .getContext("2d")!
        .drawImage(img, 0, 0, canvas.width, canvas.height);
      return await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) =>
            b ? resolve(b) : reject(new Error("Could not preserve SVG.")),
          "image/png",
        ),
      );
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  if (!["image/png", "image/jpeg", "image/webp"].includes(type))
    throw new Error(`Unsupported image format: ${type}`);
  validateFile(bytes, type);
  // Decode the image rather than trusting the extension or MIME metadata.
  const blob = new Blob([bytes as BlobPart], { type }),
    url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.naturalWidth * image.naturalHeight > 24000000)
      throw new Error("Book image exceeds safe dimensions.");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function importStructured(
  file: File,
  onProgress: (message: string, pct: number) => void,
  signal?: AbortSignal,
  htmlResources: Record<string, { bytes: Uint8Array; type: string }> = {},
): Promise<StructuredImport> {
  if (file.size > MAX_SOURCE) throw new Error("Choose a book under 20 MB.");
  const check = () => signal?.throwIfAborted();
  check();
  const epub =
    /\.epub$/i.test(file.name) || file.type === "application/epub+zip";
  const files: { id: string; blob: Blob }[] = [],
    missingResources: string[] = [],
    warnings: string[] = [];
  let title = file.name.replace(/\.[^.]+$/, ""),
    author = "",
    coverPath = "",
    documents: { path: string; text: string }[] = [],
    navPath = "";
  const resources = new Map<string, { bytes: Uint8Array; type: string }>(
    Object.entries(htmlResources),
  );
  if (epub) {
    const archive = unpackEpub(new Uint8Array(await file.arrayBuffer())),
      container = parseXml(
        decoder.decode(archive["META-INF/container.xml"] || new Uint8Array()),
      );
    const packagePath = elements(container, "rootfile")[0]?.getAttribute(
      "full-path",
    );
    if (!packagePath || !archive[packagePath])
      throw new Error("Missing EPUB package.");
    const opf = parseXml(decoder.decode(archive[packagePath]));
    title = elements(opf, "title")[0]?.textContent?.trim() || title;
    author = elements(opf, "creator")
      .map((e) => e.textContent?.trim())
      .filter(Boolean)
      .join(", ");
    const manifest = new Map(
      elements(opf, "item").map((e) => [e.getAttribute("id")!, e]),
    );
    for (const item of manifest.values()) {
      const path = resourcePath(
        packagePath,
        item.getAttribute("href") || "",
      ).path;
      if (!archive[path]) {
        missingResources.push(path);
        continue;
      }
      resources.set(path, {
        bytes: archive[path],
        type: item.getAttribute("media-type") || "",
      });
      const props = (item.getAttribute("properties") || "").split(/\s+/);
      if (props.includes("cover-image")) coverPath = path;
      if (props.includes("nav")) navPath = path;
      else if (
        !navPath &&
        item.getAttribute("media-type") === "application/x-dtbncx+xml"
      )
        navPath = path;
    }
    const coverId = elements(opf, "meta")
      .find((e) => e.getAttribute("name") === "cover")
      ?.getAttribute("content");
    if (!coverPath && coverId && manifest.get(coverId))
      coverPath = resourcePath(
        packagePath,
        manifest.get(coverId)!.getAttribute("href")!,
      ).path;
    for (const ref of elements(opf, "itemref")) {
      const item = manifest.get(ref.getAttribute("idref") || "");
      if (!item) throw new Error("EPUB spine references a missing document.");
      const path = resourcePath(packagePath, item.getAttribute("href")!).path;
      if (!archive[path])
        throw new Error("A chapter is missing from this EPUB.");
      if (!/html|xhtml/.test(item.getAttribute("media-type") || ""))
        throw new Error("Unsupported EPUB spine document.");
      documents.push({ path, text: decoder.decode(archive[path]) });
    }
    if (!documents.length) throw new Error("EPUB contains no reading order.");
  } else {
    const text = await file.text(),
      doc = new DOMParser().parseFromString(text, "text/html");
    title = doc.querySelector("title,h1")?.textContent?.trim() || title;
    author =
      doc.querySelector('meta[name="author"]')?.getAttribute("content") || "";
    documents = [{ path: "book.html", text }];
  }
  const originalDocumentCount = documents.length,
    relocatedNotices: string[] = [],
    notices: { path: string; text: string }[] = [];
  // Keep provider notices intact, after the authored work. Relative resources and
  // original fragment IDs still resolve against their original source document.
  documents = documents.map((source) => {
    const doc = new DOMParser().parseFromString(source.text, "text/html");
    const found = [...doc.querySelectorAll("#pg-header,#pg-footer")].filter(
      (node) => /Project Gutenberg/i.test(node.textContent || ""),
    );
    if (!found.length) return source;
    for (const node of found) {
      notices.push({
        path: source.path,
        text: `<html><head><title>Source and license</title></head><body>${node.outerHTML}</body></html>`,
      });
      relocatedNotices.push(`${source.path}#${node.id}`);
      node.remove();
    }
    if(!doc.body.textContent?.trim()&&!doc.body.querySelector('img,svg,math,table'))return null;
    return { ...source, text: doc.documentElement.outerHTML };
  }).filter((source):source is {path:string;text:string}=>source!==null);
  documents.push(...notices);
  const sections: Section[] = [],
    chapterLinks: NonNullable<Book["chapterLinks"]> = [],
    destinations = new Map<string, Anchor>(),
    pendingLinks: {
      block: Extract<Block, { type: "p" | "h" | "quote" }>;
      start: number;
      at: number;
      href: string;
      path: string;
    }[] = [],
    footnotes: NonNullable<Book["footnotes"]> = [];
  const removals: { kind: string; characters: number }[] = [];
  let expected = "",
    images = 0,
    sourceChars = 0;
  const imageIds = new Map<string, string>();
  const image = async (path: string) => {
    if (imageIds.has(path)) return imageIds.get(path)!;
    const resource = resources.get(path);
    if (!resource) {
      missingResources.push(path);
      throw new Error(`Missing book image: ${path}`);
    }
    const blob = await imageBlob(resource.bytes, resource.type),
      id = crypto.randomUUID();
    files.push({ id, blob });
    imageIds.set(path, id);
    return id;
  };
  let current: Section;
  for (const [di, source] of documents.entries()) {
    check();
    onProgress(
      "Preparing chapters…",
      Math.round(5 + (di / documents.length) * 80),
    );
    const doc = safeDocument(source.text, removals, warnings),
      body = doc.body;
    expected += ` ${documentText(body)}`;
    sourceChars += documentText(body).length;
    current = {
      id: crypto.randomUUID(),
      title:
        doc.querySelector("h1,h2,title")?.textContent?.trim() ||
        `Part ${di + 1}`,
      heading: false,
      blocks: [],
    };
    sections.push(current);
    const location = (): Anchor => ({
      section: sections.length - 1,
      block: current.blocks.length,
      offset: 0,
    });
    if (!destinations.has(source.path))
      destinations.set(source.path, location());
    async function walk(node: Node): Promise<void> {
      check();
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.trim();
        if (text) current.blocks.push({ type: "p", text });
        return;
      }
      if (!(node instanceof Element)) return;
      if (node.id) destinations.set(`${source.path}#${node.id}`, location());
      const tag = node.localName;
      if (
        tag === "svg" &&
        node.querySelectorAll("image").length === 1 &&
        !node.textContent?.trim()
      ) {
        const embedded = node.querySelector("image")!,
          href =
            embedded.getAttribute("href") ||
            embedded.getAttribute("xlink:href");
        if (!href) throw new Error("SVG cover is missing its image.");
        const img = document.createElement("img");
        img.setAttribute("src", href);
        await walk(img);
        return;
      }
      if (tag === "img") {
        const src = node.getAttribute("src");
        if (!src) {
          warnings.push("Image without a source.");
          return;
        }
        const path = resourcePath(source.path, src).path,
          id = await image(path);
        const blob = files.find((f) => f.id === id)!.blob,
          url = URL.createObjectURL(blob);
        try {
          const img = new Image();
          img.src = url;
          await img.decode();
          current.blocks.push({
            type: "figure",
            blobId: id,
            aspectRatio: img.naturalWidth / img.naturalHeight,
            caption: node.getAttribute("alt") || undefined,
          });
          images++;
        } finally {
          URL.revokeObjectURL(url);
        }
        return;
      }
      if (["table", "math", "svg"].includes(tag)) {
        // Render sanitized complex content once, retaining its text for search and retention checks.
        const host = document.createElement("div");
        host.style.cssText =
          "position:fixed;left:-10000px;top:0;width:900px;padding:24px;background:white;color:#222;font:18px Georgia";
        const clone = document.importNode(node, true);
        if (clone.querySelector("foreignObject"))
          throw new Error(
            "This embedded layout needs review before it can be preserved.",
          );
        const embeddedUrls: string[] = [];
        for (const embedded of clone.querySelectorAll("img,image")) {
          const href =
            embedded.getAttribute("src") ||
            embedded.getAttribute("href") ||
            embedded.getAttribute("xlink:href");
          if (!href) throw new Error("A table or diagram image is missing.");
          const path = resourcePath(source.path, href).path,
            id = await image(path),
            blob = files.find((f) => f.id === id)!.blob,
            url = URL.createObjectURL(blob);
          embeddedUrls.push(url);
          if (embedded.localName === "img") embedded.setAttribute("src", url);
          else {
            embedded.removeAttribute("xlink:href");
            embedded.setAttribute("href", url);
          }
        }
        for (const use of clone.querySelectorAll("use")) {
          const href =
            use.getAttribute("href") || use.getAttribute("xlink:href") || "";
          if (!href.startsWith("#"))
            throw new Error("External diagram references are not supported.");
        }
        for (const el of [clone, ...clone.querySelectorAll("*")])
          for (const attr of [...el.attributes])
            if (
              /url\(/i.test(attr.value) &&
              !/url\(\s*['"]?#/i.test(attr.value)
            )
              throw new Error(
                "External diagram paint resources are not supported.",
              );
        host.appendChild(clone);
        document.body.appendChild(host);
        try {
          for (const embedded of host.querySelectorAll("img"))
            await embedded.decode();
          if (host.offsetHeight <= 0 || host.offsetHeight > 8000)
            throw new Error(
              "This table or diagram is too large to preserve reliably.",
            );
          const { toBlob } = await import("html-to-image");
          const blob = await toBlob(host, {
            skipFonts: true,
            pixelRatio: 1,
            style: { left: "0px", top: "0px", position: "static" },
          });
          if (!blob) throw new Error("Could not preserve complex content.");
          const id = crypto.randomUUID();
          files.push({ id, blob });
          current.blocks.push({
            type: "figure",
            blobId: id,
            text: documentText(node),
            aspectRatio: host.offsetWidth / host.offsetHeight,
          });
          images++;
        } finally {
          host.remove();
          embeddedUrls.forEach((url) => URL.revokeObjectURL(url));
        }
        return;
      }
      const leaf =
        /^(p|h[1-6]|blockquote|pre|li|figcaption|dt|dd)$/.test(tag) &&
        !node.querySelector(
          "p,h1,h2,h3,h4,h5,h6,blockquote,pre,li,table,math,svg,img",
        );
      if (leaf) {
        if (/^h[12]$/.test(tag) && current.blocks.length) {
          current = {
            id: crypto.randomUUID(),
            title: node.textContent?.trim() || "Chapter",
            heading: false,
            level: Number(tag[1]) - 1,
            blocks: [],
          };
          sections.push(current);
          if (node.id)
            destinations.set(`${source.path}#${node.id}`, location());
        }
        let text = "";
        const styles: {
            start: number;
            end: number;
            bold?: boolean;
            italic?: boolean;
          }[] = [],
          refs: { start: number; at: number; href: string }[] = [];
        const inline = (n: Node, bold = false, italic = false) => {
          if (n.nodeType === Node.TEXT_NODE) {
            const start = text.length;
            text += n.textContent || "";
            if (bold || italic)
              styles.push({ start, end: text.length, bold, italic });
            return;
          }
          if (!(n instanceof Element)) return;
          if (n.localName === "br") {
            text += "\n";
            return;
          }
          const start = text.length;
          for (const child of n.childNodes)
            inline(
              child,
              bold || ["b", "strong"].includes(n.localName),
              italic || ["em", "i"].includes(n.localName),
            );
          if (n.localName === "a" && n.getAttribute("href"))
            refs.push({
              start,
              at: text.length,
              href: n.getAttribute("href")!,
            });
        };
        inline(node);
        const preserve =
          tag === "pre" || !!node.closest('[class*="poem"],[class*="verse"]');
        const normalized = preserve
          ? {
              text,
              runs: styles,
              offsets: Array.from({ length: text.length + 1 }, (_, i) => i),
            }
          : normalizeStyledTextWithOffsets(text, styles);
        if (!normalized.text.trim()) return;
        const block: Extract<Block, { type: "p" | "h" | "quote" }> = {
          type: /^h/.test(tag) ? "h" : tag === "blockquote" ? "quote" : "p",
          text: normalized.text,
          styles: normalized.runs,
          layout:
            tag === "pre"
              ? "code"
              : tag === "li"
                ? "list"
                : node.closest('[class*="poem"],[class*="verse"]')
                  ? "verse"
                  : undefined,
        };
        for (const el of node.querySelectorAll("[id]"))
          destinations.set(`${source.path}#${el.id}`, location());
        current.blocks.push(block);
        for (const ref of refs)
          if (
            !/^[a-z]+:|^\/\//i.test(ref.href) &&
            normalized.offsets[ref.at] > normalized.offsets[ref.start]
          )
            pendingLinks.push({
              block,
              start: normalized.offsets[ref.start],
              at: normalized.offsets[ref.at],
              href: ref.href,
              path: source.path,
            });
        if (/^h[1-6]$/.test(tag))
          chapterLinks.push({
            title: block.text,
            level: Number(tag[1]) - 1,
            at: {
              section: sections.length - 1,
              block: current.blocks.length - 1,
              offset: 0,
            },
          });
        if (
          /footnote|endnote/.test(
            node.getAttribute("epub:type") || node.getAttribute("role") || "",
          )
        ) {
          footnotes.push({
            id: `note-${footnotes.length}`,
            marker: String(footnotes.length + 1),
            text: block.text,
          });
        }
        return;
      }
      for (const child of [...node.childNodes]) await walk(child);
    }
    for (const child of [...body.childNodes]) await walk(child);
  }
  // Resolve internal hyperlinks to retained content; notes remain readable in the book too.
  for (const link of pendingLinks) {
    const target = resourcePath(link.path, link.href),
      at = destinations.get(
        `${target.path}${target.fragment ? "#" + target.fragment : ""}`,
      );
    if (at && sections[at.section]?.blocks[at.block]) {
      const note = footnotes.find(
        (n) => n.text === sections[at.section].blocks[at.block].text,
      );
      if (note)
        (link.block.footnoteRefs ||= []).push({ at: link.at, noteId: note.id });
      else
        (link.block.internalLinks ||= []).push({
          start: link.start,
          end: link.at,
          at,
        });
    } else warnings.push(`Unresolved internal link: ${link.href}`);
  }
  if (navPath) {
    const nav = resources.get(navPath);
    if (nav) {
      if (nav.type === "application/x-dtbncx+xml") {
        const doc = parseXml(
            decoder.decode(nav.bytes).replace(/<!DOCTYPE[^\[\]>]*>/i, ""),
          ),
          links: NonNullable<Book["chapterLinks"]> = [];
        for (const point of elements(doc, "navPoint")) {
          const href = elements(point, "content")[0]?.getAttribute("src"),
            title = elements(point, "navLabel")[0]?.textContent?.trim();
          if (!href || !title) continue;
          const target = resourcePath(navPath, href),
            at = destinations.get(
              `${target.path}${target.fragment ? "#" + target.fragment : ""}`,
            );
          if (!at || !sections[at.section]?.blocks[at.block]) {
            warnings.push(`Unresolved contents entry: ${title}`);
            continue;
          }
          let level = 0,
            parent = point.parentElement;
          while (parent) {
            if (parent.localName === "navPoint") level++;
            parent = parent.parentElement;
          }
          links.push({ title, level: Math.min(20, level), at });
        }
        if (links.length) {
          chapterLinks.length = 0;
          chapterLinks.push(...links);
        }
      } else {
        const doc = new DOMParser().parseFromString(
            decoder.decode(nav.bytes),
            "text/html",
          ),
          toc = doc.querySelector(
            'nav[epub\\:type="toc"],nav[role="doc-toc"],nav',
          );
        const links: NonNullable<Book["chapterLinks"]> = [];
        for (const a of toc?.querySelectorAll("a[href]") || []) {
          const target = resourcePath(navPath, a.getAttribute("href")!),
            at = destinations.get(
              `${target.path}${target.fragment ? "#" + target.fragment : ""}`,
            );
          if (!at || !sections[at.section]?.blocks[at.block]) {
            warnings.push(`Unresolved contents entry: ${a.textContent}`);
            continue;
          }
          let level = 0,
            parent = a.parentElement;
          while (parent && parent !== toc) {
            if (parent.localName === "ol") level++;
            parent = parent.parentElement;
          }
          links.push({
            title: a.textContent?.trim() || "Chapter",
            level: Math.max(0, Math.min(20, level - 1)),
            at,
          });
        }
        if (links.length) {
          chapterLinks.length = 0;
          chapterLinks.push(...links);
        }
      }
    }
  }
  for (const section of sections)
    if (!section.blocks.length)
      section.blocks.push({ type: "p", text: section.title });
  const output = sections
      .flatMap((s) => s.blocks.map((b) => b.text || ""))
      .join(" "),
    passed =
      retainedText(expected, output) &&
      !missingResources.length &&
      (sourceChars > 0 || images > 0) &&
      !warnings.some((w) => w.includes("substantial prose"));
  if (!passed) warnings.push("Content retention requires review.");
  const sourceId = crypto.randomUUID();
  files.push({
    id: sourceId,
    blob: new Blob([await file.arrayBuffer()], {
      type: epub ? "application/epub+zip" : "text/plain",
    }),
  });
  let coverId: string | undefined;
  if (coverPath) coverId = await image(coverPath);
  const now = Date.now(),
    book: Book = {
      id: crypto.randomUUID(),
      title: title.slice(0, 500),
      author: author.slice(0, 500),
      addedAt: now,
      lastOpenedAt: now,
      cover: {
        kind: coverId ? "image" : "typeset",
        color: "#3A463B",
        fg: "#F6F0E3",
        blobId: coverId,
      },
      sourceFormat: epub ? "epub" : "html",
      sourceBlobId: sourceId,
      pagination: "flow",
      printPageCount: 1,
      pageMarks: [],
      sections,
      chapterLinks,
      footnotes,
      readingMode: "reflow",
    };
  onProgress("Ready to review", 100);
  return {
    book,
    files,
    preview: files.find((f) => f.id === coverId)?.blob || new Blob(),
    removed: 0,
    fixed: 0,
    scanned: 0,
    lowConfidence: 0,
    figures: images,
    footnoteCount: footnotes.length,
    pageText: [],
    conversionReport: {
      version: 1,
      documents: originalDocumentCount,
      sourceCharacters: sourceChars,
      outputCharacters: output.length,
      missingResources,
      warnings,
      passed,
      coverPath,
      removals,
      relocatedNotices,
    },
  };
}
