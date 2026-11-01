"use client";
import { useRef, useState } from "react";
import type { Book } from "@/lib/readwind/types";
import type { Library } from "@/lib/readwind/useLibrary";
import { prepareCoverImage } from "@/lib/readwind/cover";
import { BlobImage } from "./Page";
import { CoverTitle } from "./CoverTitle";
import { Icon } from "./Icon";
import { Modal } from "./Modal";

type CoverKind = Book["cover"]["kind"];

export function coverIds(book: Book) {
  // Books imported before pdfCoverBlobId existed used the active cover blob
  // for the PDF preview unless the reader had already uploaded an image.
  const pdfId =
    book.pdfCoverBlobId ||
    (book.cover.kind !== "image" ? book.cover.blobId : undefined);
  const customId =
    book.customCoverBlobId ||
    (book.cover.kind === "image" ? book.cover.blobId : undefined);
  return { pdfId, customId };
}

/** Three clear choices instead of native radio dots or two oversized buttons. */
export function CoverPicker({
  book,
  loadBlob,
  onChange,
  onUpload,
  busy = false,
}: {
  book: Book;
  loadBlob: (id: string) => Promise<Blob | undefined>;
  onChange: (kind: CoverKind) => void;
  onUpload: (file: File) => void;
  busy?: boolean;
}) {
  const file = useRef<HTMLInputElement>(null);
  const { pdfId, customId } = coverIds(book);
  const chooseUpload = () => {
    if (customId) onChange("image");
    else file.current?.click();
  };
  return (
    <div className="cover-picker">
      <div className="cover-picker-grid" role="group" aria-label="Cover style">
        <button
          type="button"
          className="cover-choice"
          aria-pressed={book.cover.kind === "typeset"}
          disabled={busy}
          onClick={() => onChange("typeset")}
        >
          <span
            className="cover-choice-art cover-choice-typeset"
            aria-hidden="true"
          >
            <span>Aa</span>
          </span>
          <span className="cover-choice-copy">
            <strong>Readwind</strong>
            <small>Title-led design</small>
          </span>
          <span className="cover-choice-check" aria-hidden="true">
            <Icon name="check" size={13} />
          </span>
        </button>
        <button
          type="button"
          className="cover-choice"
          aria-pressed={book.cover.kind === "pdfPage"}
          disabled={busy || !pdfId}
          title={
            pdfId
              ? "Use the first page of the PDF"
              : "The PDF preview is unavailable"
          }
          onClick={() => onChange("pdfPage")}
        >
          <span className="cover-choice-art" aria-hidden="true">
            {pdfId ? (
              <BlobImage
                id={pdfId}
                loadBlob={loadBlob}
                alt=""
                className="cover-choice-image"
              />
            ) : (
              <Icon name="file" size={20} />
            )}
          </span>
          <span className="cover-choice-copy">
            <strong>PDF page 1</strong>
            <small>The original page</small>
          </span>
          <span className="cover-choice-check" aria-hidden="true">
            <Icon name="check" size={13} />
          </span>
        </button>
        <button
          type="button"
          className="cover-choice"
          aria-pressed={book.cover.kind === "image"}
          disabled={busy}
          onClick={chooseUpload}
        >
          <span className="cover-choice-art" aria-hidden="true">
            {customId ? (
              <BlobImage
                id={customId}
                loadBlob={loadBlob}
                alt=""
                className="cover-choice-image"
              />
            ) : (
              <Icon name="upload" size={20} />
            )}
          </span>
          <span className="cover-choice-copy">
            <strong>Your image</strong>
            <small>{customId ? "A personal cover" : "JPG or PNG"}</small>
          </span>
          <span className="cover-choice-check" aria-hidden="true">
            <Icon name="check" size={13} />
          </span>
        </button>
      </div>
      <button
        type="button"
        className="cover-upload-link"
        disabled={busy}
        onClick={() => file.current?.click()}
      >
        <Icon name="upload" size={15} />
        {customId ? "Replace with a different image" : "Upload a cover image"}
      </button>
      <input
        ref={file}
        hidden
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
        onChange={(event) => {
          const image = event.target.files?.[0];
          event.target.value = "";
          if (image) onUpload(image);
        }}
      />
    </div>
  );
}

export function BookEditor({
  book,
  library,
  onClose,
}: {
  book: Book;
  library: Library;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState(book.title);
  const [titleMessage, setTitleMessage] = useState("");
  const rename = async (closeAfterSave = false) => {
    setBusy(true);
    setError("");
    setTitleMessage("");
    try {
      await library.renameBook(book.id, title);
      setTitle(title.trim());
      setTitleMessage("Title saved.");
      if (closeAfterSave) onClose();
    } catch (e) {
      setError((e as Error).message || "Could not rename this book.");
    } finally {
      setBusy(false);
    }
  };
  const hasArt = book.cover.kind === "image" || book.cover.kind === "pdfPage";
  const choose = async (kind: CoverKind) => {
    const { pdfId, customId } = coverIds(book);
    const blobId =
      kind === "pdfPage" ? pdfId : kind === "image" ? customId : pdfId;
    if (!blobId && kind !== "typeset") return;
    setBusy(true);
    setError("");
    try {
      await library.saveBook({
        ...book,
        pdfCoverBlobId: pdfId,
        cover: { ...book.cover, kind, blobId },
      });
    } catch (e) {
      setError((e as Error).message || "Could not save the cover.");
    } finally {
      setBusy(false);
    }
  };
  const upload = async (file: File) => {
    setBusy(true);
    setError("");
    try {
      const { pdfId } = coverIds(book);
      const blob = await prepareCoverImage(file);
      const id = crypto.randomUUID();
      await library.saveBook(
        {
          ...book,
          pdfCoverBlobId: pdfId,
          customCoverBlobId: id,
          cover: { ...book.cover, kind: "image", blobId: id },
        },
        [{ id, blob }],
      );
    } catch (e) {
      setError((e as Error).message || "Could not use that image.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Edit book" className="cover-modal" onClose={onClose}>
      <div className="cover-editor">
        <div
          className="shelf-cover cover-editor-preview"
          style={{ background: book.cover.color, color: book.cover.fg }}
        >
          {hasArt && book.cover.blobId ? (
            <BlobImage
              id={book.cover.blobId}
              loadBlob={library.loadBlob}
              alt={`${book.title} cover`}
              className="pdf-cover"
            />
          ) : (
            <>
              <CoverTitle text={book.title} maxSize={26} />
              <span>{book.author}</span>
            </>
          )}
        </div>
        <div className="cover-editor-copy">
          <form
            className="book-title-form"
            onSubmit={(event) => {
              event.preventDefault();
              void rename();
            }}
            noValidate
          >
            <label htmlFor={`book-title-${book.id}`}>Book title</label>
            <input
              id={`book-title-${book.id}`}
              type="text"
              value={title}
              maxLength={500}
              disabled={busy}
              onChange={(event) => {
                setTitle(event.target.value);
                setTitleMessage("");
                setError("");
              }}
            />
            <button
              className="button"
              type="submit"
              disabled={busy || title === book.title}
            >
              {busy ? "Saving…" : "Save title"}
            </button>
            {titleMessage && (
              <p className="muted" role="status">
                {titleMessage}
              </p>
            )}
          </form>
          <p>
            Choose a fresh face for <strong>{book.title}</strong>. Your pick
            appears on the shelf, the cover, and every device.
          </p>
          <CoverPicker
            book={book}
            loadBlob={library.loadBlob}
            onChange={(kind) => void choose(kind)}
            onUpload={(file) => void upload(file)}
            busy={busy}
          />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
      <div className="modal-actions">
        <button
          className="button primary"
          disabled={busy}
          onClick={() => {
            if (title !== book.title) void rename(true);
            else onClose();
          }}
        >
          {busy ? "Saving…" : "Done"}
        </button>
      </div>
    </Modal>
  );
}
