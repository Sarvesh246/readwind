"use client";
import { useEffect, useId, useState } from "react";
import { Modal } from "./Modal";
import { settleDialog, subscribeDialogs, type DialogRequest } from "@/lib/readwind/dialogs";

function FormDialog({ request }: { request: Extract<DialogRequest, { kind: "form" }> }) {
  const id = useId();
  const [values, setValues] = useState(() => Object.fromEntries(request.fields.map((f) => [f.name, f.initial ?? ""])));
  const done = (v: Record<string, string> | null) => { request.resolve(v); settleDialog(request); };
  const problem = (f: (typeof request.fields)[number]) => {
    const v = values[f.name];
    if (f.mustEqual !== undefined) return v === f.mustEqual ? "" : `Type ${f.mustEqual} to continue.`;
    if (f.minLength && v.length < f.minLength) return `Use at least ${f.minLength} characters.`;
    return "";
  };
  const blocked = request.fields.some((f) => (f.mustEqual !== undefined || f.minLength || f.type === "password") && (!values[f.name] || problem(f)));
  return (
    <Modal title={request.title} className="dialog-host" onClose={() => done(null)}>
      <form className="dialog-form" onSubmit={(e) => { e.preventDefault(); if (!blocked) done(values); }}>
        {request.message && <p>{request.message}</p>}
        {request.fields.map((f, i) => (
          <label key={f.name} className="dialog-field" htmlFor={`${id}-${f.name}`}>
            <span>{f.label}</span>
            <input
              id={`${id}-${f.name}`} name={f.name} type={f.type ?? "text"} autoFocus={i === 0}
              autoComplete={f.autoComplete ?? "off"} placeholder={f.placeholder} value={values[f.name]}
              spellCheck={false} autoCapitalize="off"
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            />
            {f.hint && <small className="field-hint">{f.hint}</small>}
            {values[f.name] && problem(f) && f.minLength ? <small className="dialog-problem" role="status">{problem(f)}</small> : null}
          </label>
        ))}
        <div className="delete-confirm-actions">
          <button type="button" className="button" onClick={() => done(null)}>Cancel</button>
          <button type="submit" className={`button ${request.danger ? "delete-confirm-button" : "primary"}`} disabled={blocked}>{request.confirmLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

function MessageDialog({ request }: { request: Exclude<DialogRequest, { kind: "form" }> }) {
  const confirm = request.kind === "confirm";
  const done = (ok: boolean) => { if (request.kind === "confirm") request.resolve(ok); else request.resolve(); settleDialog(request); };
  return (
    <Modal title={request.title} className="dialog-host" onClose={() => done(false)}>
      <p>{request.message}</p>
      <div className="delete-confirm-actions">
        {confirm && <button type="button" className="button" onClick={() => done(false)}>Cancel</button>}
        <button type="button" autoFocus className={`button ${confirm && request.danger ? "delete-confirm-button" : "primary"}`} onClick={() => done(true)}>
          {confirm ? request.confirmLabel : "OK"}
        </button>
      </div>
    </Modal>
  );
}

export function DialogHost() {
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  useEffect(() => subscribeDialogs(setQueue), []);
  const current = queue[0];
  if (!current) return null;
  return current.kind === "form" ? <FormDialog key={queue.length + current.title} request={current} /> : <MessageDialog key={queue.length + current.title} request={current} />;
}
