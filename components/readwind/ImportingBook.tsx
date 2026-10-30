"use client";
import { importJobState, type ImportJob } from "@/lib/readwind/import-jobs";

/** A shelf placeholder for a PDF that is still being imported, possibly on another device. */
export function ImportingBook({
  job,
  thisDevice,
  onDismiss,
}: {
  job: ImportJob;
  thisDevice: boolean;
  onDismiss: () => void;
}) {
  const state = importJobState(job);
  const active = state === "running";
  const where = thisDevice ? "here" : "on your other device";
  const status =
    state === "running"
      ? job.message || "Importing…"
      : state === "ready"
        ? thisDevice
          ? "Ready to review"
          : "Finished. Open Readwind on the device that started it to add the book."
        : state === "interrupted"
          ? `Stopped. Imports only continue while Readwind is open ${where}. Start it again there.`
          : "This import failed. Try the file again.";
  return (
    <div className="shelf-cell import-cell" data-import-id={job.id} data-import-state={state}>
      <div className="shelf-item" aria-live="polite">
        <div className={`import-ghost ${active ? "active" : ""}`}>
          <span className="import-ghost-title">{job.title}</span>
          <span className="import-ghost-percent" aria-hidden="true">
            {state === "ready" ? "Done" : state === "running" ? `${job.percent}%` : "Paused"}
          </span>
        </div>
        <div className="shelf-status">
          <div
            className="shelf-progress"
            role="progressbar"
            aria-label={`Importing ${job.title}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={job.percent}
          >
            <div style={{ width: `${job.percent}%` }} />
          </div>
          <span>{status}</span>
        </div>
      </div>
      {!active && state !== "ready" && (
        <button className="button import-dismiss" onClick={onDismiss}>
          Dismiss
        </button>
      )}
    </div>
  );
}
