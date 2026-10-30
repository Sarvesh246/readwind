"use client";
import { useEffect, useRef, useState } from "react";
import type { Library } from "@/lib/readwind/useLibrary";
import type { Imported } from "@/lib/readwind/pdf";
import { prepareCoverImage } from "@/lib/readwind/cover";
import type { Book } from "@/lib/readwind/types";
import { pdfIssueLabels } from "@/lib/readwind/pdf-layout";
import { addChapterAtPage } from "@/lib/readwind/chapters";
import { Icon } from "./Icon";
import { Cover } from "./Library";
import { CoverPicker, coverIds } from "./CoverPicker";
import { ChapterTitleInput } from "./ChapterTitleInput";
import { PdfPreview } from "./PdfPreview";
import {OcrLanguages} from "./OcrLanguages";
export function Import({
  library: l,
  navigate,
  initialFile,
}: {
  library: Library;
  navigate: (url: string) => void;
  initialFile?: File | null;
}) {
  const [file, setFile] = useState<File | null>(initialFile || null),
    [result, setResult] = useState<Imported | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [pct, setPct] = useState(0),
    [error, setError] = useState(""),
    [step, setStep] = useState(1),
    [previewPage, setPreviewPage] = useState(0),
    [password,setPassword]=useState(""),
    [needsPassword,setNeedsPassword]=useState(false),
    [ocrLanguage,setOcrLanguage]=useState("eng"),
    [options, setOptions] = useState({
      removeHeaders: true,
      joinHyphens: true,
      ocr: true,
      verifyText:true,
      verifyAllText:false,
      textLayout:"auto" as "auto"|"verse"|"code"|"dialogue",
    });
  const [chapterTitle, setChapterTitle] = useState(""), [chapterPage, setChapterPage] = useState(""), [chapterError, setChapterError] = useState(""), [printedPage, setPrintedPage] = useState("");
  const [openEditors,setOpenEditors]=useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null),
    controller = useRef<AbortController | null>(null),
    request=useRef(0);
  const [coverBusy, setCoverBusy] = useState(false),
    [coverError, setCoverError] = useState("");
  // The shelf on other devices mirrors this import's progress, so tell it when we stop.
  const job = useRef<{ id: string; title: string; percent: number; message: string; sent: number } | null>(null);
  const clearImport = useRef(l.clearImport);
  useEffect(() => { clearImport.current = l.clearImport; });
  useEffect(() => () => {
    request.current++;
    controller.current?.abort();
    if (job.current) void clearImport.current(job.current.id);
  }, []);
  async function parse(f: File) {
    const run=++request.current;
    setFile(f);
    setPreviewPage(0);
    setPrintedPage("");
    setNeedsPassword(false);
    setBusy(true);
    setError("");
    setResult(null);
    controller.current?.abort();
    controller.current = new AbortController();
    if (job.current) void l.clearImport(job.current.id);
    const jobId = crypto.randomUUID(), title = f.name.replace(/\.pdf$/i, "").slice(0, 200) || "Untitled PDF";
    job.current = { id: jobId, title, percent: 0, message: "Starting…", sent: 0 };
    const publish = (status: "running" | "ready" | "failed", percent: number, message: string, force = false) => {
      const current = job.current;
      if (!current || current.id !== jobId) return;
      current.percent = percent;
      current.message = message;
      if (!force && Date.now() - current.sent < 2500) return;
      current.sent = Date.now();
      void l.reportImport({ id: jobId, title, percent, message, status });
    };
    publish("running", 0, "Starting…", true);
    // Long single steps (loading the OCR engine) report nothing, which would look like a stall elsewhere.
    const heartbeat = setInterval(() => {
      const current = job.current;
      if (current && current.id === jobId) publish("running", current.percent, current.message, true);
    }, 15000);
    try {
      const { importPDF } = await import("@/lib/readwind/pdf");
      const data = await importPDF(
        f,
        {...options,password,ocrLanguage},
        (m, p) => {
          if(run!==request.current)return;
          setMessage(m);
          setPct(p);
          publish("running", p, m);
        },
        controller.current.signal,
      );
      if(run!==request.current)return;
      setResult(data);
      setStep(2);
      publish("ready", 100, "Ready to review", true);
    } catch (e) {
      if(run!==request.current)return;
      if ((e as Error).name === "PasswordException") { setNeedsPassword(true); void l.clearImport(jobId); }
      else if ((e as Error).name !== "AbortError" && !controller.current?.signal.aborted)
        publish("failed", job.current?.percent ?? 0, "Could not import this PDF", true);
      if ((e as Error).name !== "AbortError" && !controller.current?.signal.aborted)
        setError(
          (e as Error).message ||
            "Could not open this PDF. It may be encrypted or damaged.",
        );
    } finally {
      clearInterval(heartbeat);
      if(run===request.current)setBusy(false);
    }
  }
  useEffect(() => {
    if (initialFile) void parse(initialFile);
  }, []);
  const setBook = (patch: Partial<Imported["book"]>) =>
    setResult((r) => (r ? { ...r, book: { ...r.book, ...patch } } : r));
  const changeCover = (kind: Book["cover"]["kind"]) => {
    if (!result) return;
    const { pdfId, customId } = coverIds(result.book);
    setCoverError("");
    setBook({
      cover: {
        ...result.book.cover,
        kind,
        blobId:
          kind === "pdfPage" ? pdfId : kind === "image" ? customId : pdfId,
      },
    });
  };
  const uploadCover = async (image: File) => {
    if (!result) return;
    setCoverBusy(true);
    setCoverError("");
    try {
      const blob = await prepareCoverImage(image);
      const id = crypto.randomUUID();
      setResult((current) =>
        current
          ? {
              ...current,
              files: [
                ...current.files.filter(
                  (file) => file.id !== current.book.customCoverBlobId,
                ),
                { id, blob },
              ],
              book: {
                ...current.book,
                customCoverBlobId: id,
                cover: { ...current.book.cover, kind: "image", blobId: id },
              },
            }
          : current,
      );
    } catch (e) {
      setCoverError((e as Error).message || "Could not use that image.");
    } finally {
      setCoverBusy(false);
    }
  };
  const create = async () => {
    if (!result) return;
    setBusy(true);
    setError("");
    try {
      await l.addBook(result.book, result.files);
      if (job.current) void l.clearImport(job.current.id);
      setStep(3);
      navigate(`/book/${result.book.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  function mergeChapter(i: number) {
    if (!result || i < 1) return;
    const b = structuredClone(result.book),
      prev = b.sections[i - 1],
      offset = prev.blocks.length;
    prev.blocks.push(...b.sections[i].blocks);
    b.sections.splice(i, 1);
    b.pageMarks = b.pageMarks.map((m) =>
      m.at.section === i
        ? { ...m, at: { ...m.at, section: i - 1, block: m.at.block + offset } }
        : m.at.section > i
          ? { ...m, at: { ...m.at, section: m.at.section - 1 } }
          : m,
    );
    setBook(b);
  }
  function splitChapter(si: number, bi: number) {
    if (!result || bi < 1) return;
    const b = structuredClone(result.book),
      sec = b.sections[si];
    b.sections.splice(si + 1, 0, {
      id: crypto.randomUUID(),
      title: "New chapter",
      heading: true,
      blocks: sec.blocks.splice(bi),
    });
    b.pageMarks = b.pageMarks.map((m) =>
      m.at.section === si && m.at.block >= bi
        ? { ...m, at: { ...m.at, section: si + 1, block: m.at.block - bi } }
        : m.at.section > si
          ? { ...m, at: { ...m.at, section: m.at.section + 1 } }
          : m,
    );
    setBook(b);
  }
  return (
    <div className="app-shell import-screen">
      <header className="document-header">
        <button
          className="icon-button"
          aria-label="Cancel import"
          onClick={() => {
            controller.current?.abort();
            navigate("/");
          }}
        >
          <Icon name="close" />
        </button>
        <h1>Turn this PDF into a book</h1>
        <ol className="import-steps" aria-label="Steps">
          {["Upload", "Clean up", "Read"].map((v, i) => (
            <li key={v} aria-current={step === i + 1 ? "step" : undefined}>
              <span>
                {step > i + 1 ? <Icon name="check" size={13} /> : i + 1}
              </span>
              {v}
            </li>
          ))}
        </ol>
      </header>
      {!result ? (
        <main className="upload-stage">
          <div
            className="upload-card"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) void parse(f);
            }}
          >
            <Icon name="upload" size={36} />
            <h2>Your next good read starts here.</h2>
            <p>
              Drop a PDF. We’ll find the chapters, clean up the text,
              <br />
              and give it room to breathe.
            </p>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              {busy ? "Opening your PDF…" : "Choose a PDF"}
            </button>
            <input
              ref={input}
              hidden
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => {
                if (e.target.files?.[0]) void parse(e.target.files[0]);
              }}
            />
            <small>Text PDFs and scanned books · up to 20 MB</small>
            <div className="upload-options">
              {(['removeHeaders','joinHyphens','ocr'] as const).map(key => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={options[key]}
                    disabled={busy}
                    onChange={(e) =>
                      setOptions({ ...options, [key]: e.target.checked })
                    }
                  />
                  {
                    {
                      removeHeaders: "Remove running headers and page numbers",
                      joinHyphens: "Re-join words split across lines",
                      ocr: "Recognize scanned pages with OCR",
                    }[key]
                  }
                </label>
              ))}
            </div>
            <small>Text pages use fast extraction. If a page needs recognition, OCR turns on automatically even when unchecked.</small>
            <OcrLanguages value={ocrLanguage} onChange={setOcrLanguage} disabled={busy}/>
            {needsPassword && <form onSubmit={e=>{e.preventDefault();if(file)void parse(file);}}><label>PDF password<input type="password" autoFocus required value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="button" disabled={busy}>Unlock and retry</button><p className="muted">The password is used to open this file and is never saved.</p></form>}
            {busy && (
              <div className="import-progress" role="status">
                <progress value={pct} max="100" />
                <p>{message}</p>
                <button onClick={() => controller.current?.abort()}>
                  Cancel
                </button>
              </div>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </main>
      ) : (
        <div className="import-columns">
          <section className="pdf-preview">
            <small>
              {file?.name} · {result.book.printPageCount} pages · page{" "}
              {previewPage + 1} shown
            </small>
            {file && <PdfPreview file={file} password={password} index={previewPage}/>}
            <div className="preview-navigation">
              <button
                className="icon-button"
                aria-label="Previous preview page"
                disabled={previewPage === 0}
                onClick={() => {setPreviewPage((n) => n - 1);setPrintedPage("");}}
              >
                <Icon name="back" />
              </button>
              <span>
                Printed page {result.book.pageMarks[previewPage]?.label} · PDF {previewPage + 1} of {result.book.printPageCount}
              </span>
              <button
                className="icon-button"
                aria-label="Next preview page"
                disabled={previewPage === result.book.printPageCount - 1}
                onClick={() => {setPreviewPage((n) => n + 1);setPrintedPage("");}}
              >
                <Icon name="next" />
              </button>
            </div>
            <label>Printed page label for this preview
              <input aria-label="Printed page label" value={printedPage} placeholder={result.book.pageMarks[previewPage]?.label} onChange={e=>setPrintedPage(e.target.value)} />
            </label>
            <button type="button" className="button small" disabled={!printedPage.trim()} onClick={()=>{
              setBook({pageMarks:result.book.pageMarks.map(m=>m.index===previewPage?{...m,label:printedPage.trim()}:m)});setPrintedPage("");
            }}>Set page label</button>
            <button type="button" className="button small" disabled={!/^[1-9]\d*$/.test(printedPage)} onClick={()=>{
              setBook({pageMarks:result.book.pageMarks.map(m=>m.index>=previewPage?{...m,label:String(Number(printedPage)+m.index-previewPage)}:m)});setPrintedPage("");
            }}>Number this and following pages</button>
            <p className="muted">Enter the number printed on the book page, including Roman numerals for front matter. Use sequential numbering only where the book has no gaps or numbering resets.</p>
            <p className="muted">
              This preview shows the original page. Review adjustable text and chapter boundaries in the editor before choosing that mode.
            </p>
          </section>
          <form
            className="import-form"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <div className="import-metadata">
              <Cover
                book={result.book}
                loadBlob={async (id) =>
                  result.files.find((f) => f.id === id)?.blob
                }
              />
              <div>
                <label>
                  Title
                  <input
                    required
                    maxLength={500}
                    value={result.book.title}
                    onChange={(e) => setBook({ title: e.target.value })}
                  />
                </label>
                <label>
                  Author
                  <input
                    value={result.book.author}
                    onChange={(e) => setBook({ author: e.target.value })}
                  />
                </label>
              </div>
            </div>
            <div className="import-cover">
              <h3>Cover</h3>
              <CoverPicker
                book={result.book}
                loadBlob={async (id) =>
                  result.files.find((f) => f.id === id)?.blob
                }
                onChange={changeCover}
                onUpload={(image) => void uploadCover(image)}
                busy={coverBusy}
              />
              {coverError && (
                <p className="form-error" role="alert">
                  {coverError}
                </p>
              )}
            </div>
            <div className="pdf-quality">
              <details>
                <summary>Recognition and cleanup options</summary>
                <OcrLanguages value={ocrLanguage} onChange={setOcrLanguage}/>
                <label>Check selectable text against the page<select disabled={!options.ocr} value={!options.verifyText?"off":options.verifyAllText?"all":"sample"} onChange={e=>setOptions({...options,verifyText:e.target.value!=="off",verifyAllText:e.target.value==="all"})}><option value="sample">Automatic: suspicious pages and regular samples</option><option value="all">Every text page (slower)</option><option value="off">Off</option></select></label>
                <label><input type="checkbox" checked={options.ocr} onChange={e=>setOptions({...options,ocr:e.target.checked})}/> Use OCR for sparse pages and optional text checks</label>
                <small>Required recognition is automatic even when this is unchecked.</small>
                <label><input type="checkbox" checked={options.removeHeaders} onChange={e=>setOptions({...options,removeHeaders:e.target.checked})}/> Remove running headers and page numbers</label>
                <label>Text structure<select value={options.textLayout} onChange={e=>setOptions({...options,textLayout:e.target.value as typeof options.textLayout})}><option value="auto">Automatic</option><option value="verse">Preserve lines and stanzas</option><option value="dialogue">Preserve dialogue and stage directions</option><option value="code">Preserve code and indentation</option></select></label>
                <label><input type="checkbox" checked={options.joinHyphens} onChange={e=>setOptions({...options,joinHyphens:e.target.checked})}/> Re-join words split across lines</label>
                <p className="muted">Reprocessing uses these options and replaces your current review edits.</p>
                <button type="button" className="button small" disabled={busy || !file} onClick={()=>{if(file)void parse(file);}}>Reprocess PDF</button>
              </details>
              <h3>How would you like to read?</h3>
              <div
                className="reading-mode-options"
                role="group"
                aria-label="Reading mode"
              >
                <button
                  type="button"
                  className="reading-mode-option"
                  aria-pressed={result.book.readingMode === "reflow"}
                  onClick={() => setBook({ readingMode: "reflow" })}
                >
                  <span className="reading-mode-glyph" aria-hidden="true">
                    <span>Aa</span>
                  </span>
                  <span className="reading-mode-copy">
                    <strong>
                      Adjustable text {result.book.importReport?.recommendedMode === "reflow" && <em>Recommended</em>}
                    </strong>
                    <small>Change the font, size, and spacing</small>
                  </span>
                </button>
                <button
                  type="button"
                  className="reading-mode-option"
                  aria-pressed={result.book.readingMode === "original"}
                  onClick={() => setBook({ readingMode: "original" })}
                >
                  <span className="reading-mode-glyph" aria-hidden="true">
                    <Icon name="file" size={18} />
                  </span>
                  <span className="reading-mode-copy">
                    <strong>Original layout {result.book.importReport?.recommendedMode === "original" && <em>Recommended</em>}</strong>
                    <small>Keep every printed page exactly as it is</small>
                  </span>
                </button>
              </div>
              <p>
                The recommended mode reflects the quality of this import.
                Original layout is the safest choice for tables, equations, and
                complex page designs. You can switch modes later.
              </p>
              {result.book.importReport?.warnings.map(w=><p key={w}>{w}</p>)}
              <details><summary>Review page quality</summary>{result.book.importReport?.pages.filter(p=>p.issues.length||p.verification).map(p=><button type="button" className="pdf-chapter" key={p.index} onClick={()=>{setPreviewPage(p.index);setPrintedPage("");}}>Page {result.book.pageMarks[p.index]?.label}: {p.issues.map(issue=>pdfIssueLabels[issue]).join(", ")}{p.sourcePreserved ? " / Original page retained" : ""}{p.verification ? ` / Visual check: ${p.verification}` : ""}{p.ocrConfidence !== undefined ? ` / OCR confidence ${Math.round(p.ocrConfidence)}%` : ""}</button>)}</details>
            </div>
            <fieldset className="chapter-review">
              <legend>Chapters and front matter ({result.book.sections.length})</legend>
              {new Set(result.book.pageMarks.map(m=>m.label.toLowerCase())).size !== result.book.pageMarks.length && <p role="alert" className="form-error">Some printed page labels repeat. Give those pages unique labels in the preview so navigation can identify them.</p>}
              <p className="muted">Chapter pages use the printed labels in the book. Select a chapter’s page to check its original scan.</p>
              <div className="chapter-add">
              <label>New chapter title<input maxLength={500} value={chapterTitle} placeholder="e.g. Introduction" onChange={e=>setChapterTitle(e.target.value)} /></label>
              <label>Chapter starts on printed page<input maxLength={120} value={chapterPage} placeholder="113 or ix" onChange={e=>setChapterPage(e.target.value)} /></label>
              <button type="button" className="button small" onClick={()=>{try {setBook(addChapterAtPage(result.book,chapterPage,chapterTitle));setChapterError("");setChapterTitle("");setChapterPage("");}catch(e){setChapterError((e as Error).message);}}}>Add chapter</button>
              </div>
              {chapterError && <p className="form-error" role="alert">{chapterError}</p>}
              <div className="chapter-edit-list">
                {result.book.sections.map((sec, si) => (
                  <div className="chapter-edit" key={sec.id}>
                    <div className="chapter-edit-main">
                      <span>{si + 1}</span>
                      <ChapterTitleInput label={`Chapter ${si + 1} title`} title={sec.title} onChange={value=>{
                        const sections=[...result.book.sections];sections[si]={...sec,title:value};setBook({sections});
                      }}/>
                    </div>
                    <div className="chapter-edit-actions">
                      <button type="button" className="chapter-page" onClick={()=>{const mark=result.book.pageMarks.find(m=>m.at.section===si);if(mark){setPreviewPage(mark.index);setPrintedPage("");}}}><Icon name="file" size={15}/> View page {result.book.pageMarks.find(m=>m.at.section===si)?.label || "unknown"}</button>
                      {si>0 && <button type="button" className="chapter-merge" onClick={()=>mergeChapter(si)}>Merge with previous</button>}
                    </div>
                    <details onToggle={e=>{const open=e.currentTarget.open;setOpenEditors(current=>open?[...new Set([...current,sec.id])]:current.filter(id=>id!==sec.id));}}>
                      <summary>Edit text / split</summary>
                      {openEditors.includes(sec.id) && sec.blocks.map((b, bi) => (
                        <div key={bi}>
                          {b.type !== "figure" && (
                            <textarea
                              aria-label={`Chapter ${si + 1} paragraph ${bi + 1}`}
                              value={b.text}
                              onChange={(e) => {
                                const sections = structuredClone(
                                  result.book.sections,
                                );
                                sections[si].blocks[bi] = {
                                  ...b,
                                  text: e.target.value,
                                };
                                setBook({ sections });
                              }}
                            />
                          )}
                          {bi > 0 && (
                            <button
                              type="button"
                              onClick={() => splitChapter(si, bi)}
                            >
                              Start a chapter here
                            </button>
                          )}
                        </div>
                      ))}
                    </details>
                  </div>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Clean-up</legend>
              <div className="cleanup-stat">
                <Icon name="check" size={17} />
                <span>Running headers and page numbers</span>
                <small>{result.removed} removed</small>
              </div>
              <div className="cleanup-stat">
                <Icon name="check" size={17} />
                <span>Words split across lines</span>
                <small>{result.fixed} fixed</small>
              </div>
              <div className="cleanup-stat">
                <Icon name="check" size={17} />
                <span>Image-based pages detected</span>
                <small>{result.scanned} pages</small>
              </div>
              {result.lowConfidence > 0 && (
                <p className="form-error">
                  {result.lowConfidence} scanned pages have low recognition
                  confidence. Review the text above.
                </p>
              )}
              <div className="cleanup-stat">
                <Icon name="check" size={17} />
                <span>Extracted figures and tables</span>
                <small>{result.figures || 0} images</small>
              </div>
              <div className="cleanup-stat">
                <Icon name="check" size={17} />
                <span>Tap-to-read footnotes</span>
                <small>{result.footnoteCount || 0} found</small>
              </div>
              <p className="muted">
                Review complex layouts against the original PDF before reading.
              </p>
            </fieldset>
            <div className="import-submit">
              <small>
                The original PDF stays attached — flip to it any time from the
                reader.
              </small>
              <button className="button primary" disabled={busy}>
                {busy ? "Saving your book…" : "Create book"}
              </button>
            </div>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
