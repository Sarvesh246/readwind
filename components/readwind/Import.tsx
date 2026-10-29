"use client";
import { useEffect, useRef, useState } from "react";
import type { Library } from "@/lib/readwind/useLibrary";
import type { Imported } from "@/lib/readwind/pdf";
import { Icon } from "./Icon";
import { Cover } from "./Library";
import { PdfPreview } from "./PdfPreview";
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
      ocr: false,
    });
  const input = useRef<HTMLInputElement>(null),
    controller = useRef<AbortController | null>(null),
    request=useRef(0);
  useEffect(() => () => { request.current++; controller.current?.abort(); }, []);
  async function parse(f: File) {
    const run=++request.current;
    setFile(f);
    setPreviewPage(0);
    setNeedsPassword(false);
    setBusy(true);
    setError("");
    setResult(null);
    controller.current?.abort();
    controller.current = new AbortController();
    try {
      const { importPDF } = await import("@/lib/readwind/pdf");
      const data = await importPDF(
        f,
        {...options,password,ocrLanguage},
        (m, p) => {
          if(run!==request.current)return;
          setMessage(m);
          setPct(p);
        },
        controller.current.signal,
      );
      if(run!==request.current)return;
      setResult(data);
      setStep(2);
    } catch (e) {
      if(run!==request.current)return;
      if ((e as Error).name === "PasswordException") setNeedsPassword(true);
      if ((e as Error).name !== "AbortError" && !controller.current?.signal.aborted)
        setError(
          (e as Error).message ||
            "Could not open this PDF. It may be encrypted or damaged.",
        );
    } finally {
      if(run===request.current)setBusy(false);
    }
  }
  useEffect(() => {
    if (initialFile) void parse(initialFile);
  }, []);
  const setBook = (patch: Partial<Imported["book"]>) =>
    setResult((r) => (r ? { ...r, book: { ...r.book, ...patch } } : r));
  const create = async () => {
    if (!result) return;
    setBusy(true);
    setError("");
    try {
      await l.addBook(result.book, result.files);
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
            <small>Text PDFs and scanned books · up to 50 MB</small>
            <div className="upload-options">
              {Object.entries(options).map(([key, value]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={value}
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
            {options.ocr && <label>OCR language <select disabled={busy} value={ocrLanguage} onChange={e=>setOcrLanguage(e.target.value)}>{[['eng','English'],['spa','Spanish'],['fra','French'],['deu','German'],['por','Portuguese'],['hin','Hindi'],['ara','Arabic'],['jpn','Japanese'],['chi_sim','Chinese (simplified)']].map(([v,t])=><option key={v} value={v}>{t}</option>)}</select><small>OCR requires a language download and may need correction. The original scan is always kept.</small></label>}
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
                onClick={() => setPreviewPage((n) => n - 1)}
              >
                <Icon name="back" />
              </button>
              <span>
                Page {previewPage + 1} of {result.book.printPageCount}
              </span>
              <button
                className="icon-button"
                aria-label="Next preview page"
                disabled={previewPage === result.book.printPageCount - 1}
                onClick={() => setPreviewPage((n) => n + 1)}
              >
                <Icon name="next" />
              </button>
            </div>
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
                <div className="inline-actions">
                  <button
                    type="button"
                    className="button small"
                    aria-pressed={result.book.cover.kind === "typeset"}
                    onClick={() =>
                      setBook({
                        cover: { ...result.book.cover, kind: "typeset" },
                      })
                    }
                  >
                    Typeset cover
                  </button>
                  <button
                    type="button"
                    className="button small"
                    aria-pressed={result.book.cover.kind === "pdfPage"}
                    onClick={() =>
                      setBook({
                        cover: { ...result.book.cover, kind: "pdfPage" },
                      })
                    }
                  >
                    Use PDF page 1
                  </button>
                </div>
              </div>
            </div>
            <div className="pdf-quality">
              <h3>How would you like to read?</h3>
              <label><input type="radio" name="reading-mode" checked={result.book.readingMode==='original'} onChange={()=>setBook({readingMode:'original'})}/>Original layout · preserve fonts, images, and formatting</label>
              <label><input type="radio" name="reading-mode" checked={result.book.readingMode==='reflow'} onChange={()=>setBook({readingMode:'reflow'})}/>Adjustable text · change font and size</label>
              <p>Original layout is the safest choice for every PDF. Adjustable text is a conversion and can change tables, equations, footnotes, and reading order. You can switch modes later.</p>
              {result.book.importReport?.warnings.map(w=><p key={w}>{w}</p>)}
            </div>
            <fieldset>
              <legend>{result.book.sections.length} chapters found</legend>
              <div className="chapter-edit-list">
                {result.book.sections.map((sec, si) => (
                  <div className="chapter-edit" key={sec.id}>
                    <span>{si + 1}</span>
                    <input
                      aria-label={`Chapter ${si + 1} title`}
                      value={sec.title}
                      onChange={(e) => {
                        const sections = [...result.book.sections];
                        sections[si] = { ...sec, title: e.target.value };
                        setBook({ sections });
                      }}
                    />
                    {si > 0 && (
                      <button type="button" onClick={() => mergeChapter(si)}>
                        Merge ↑
                      </button>
                    )}
                    <details>
                      <summary>Edit text / split</summary>
                      {sec.blocks.map((b, bi) => (
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
