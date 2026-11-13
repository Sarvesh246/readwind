/**
 * Imperative in-app replacements for window.prompt / confirm / alert. Callers await a promise;
 * <DialogHost /> (mounted once) renders the request through the shared Modal.
 */
export type DialogField = {
  name: string;
  label: string;
  type?: "text" | "password";
  placeholder?: string;
  initial?: string;
  minLength?: number;
  /** The field is valid only when it equals this exact text (e.g. "DELETE"). */
  mustEqual?: string;
  autoComplete?: string;
  hint?: string;
};
export type DialogRequest =
  | { kind: "form"; title: string; message?: string; fields: DialogField[]; confirmLabel: string; danger?: boolean; resolve: (v: Record<string, string> | null) => void }
  | { kind: "confirm"; title: string; message: string; confirmLabel: string; danger?: boolean; resolve: (v: boolean) => void }
  | { kind: "alert"; title: string; message: string; resolve: () => void };
type Listener = (queue: DialogRequest[]) => void;
let queue: DialogRequest[] = [];
const listeners = new Set<Listener>();
const publish = () => listeners.forEach((l) => l(queue));
export function subscribeDialogs(l: Listener) {
  listeners.add(l);
  l(queue);
  return () => void listeners.delete(l);
}
export function settleDialog(request: DialogRequest) {
  queue = queue.filter((r) => r !== request);
  publish();
}
function enqueue(request: DialogRequest) {
  queue = [...queue, request];
  publish();
}
export const askForm = (o: { title: string; message?: string; fields: DialogField[]; confirmLabel?: string; danger?: boolean }) =>
  new Promise<Record<string, string> | null>((resolve) => enqueue({ kind: "form", confirmLabel: "Continue", ...o, resolve }));
export const askText = async (o: { title: string; message?: string; field: DialogField; confirmLabel?: string }) =>
  (await askForm({ title: o.title, message: o.message, fields: [o.field], confirmLabel: o.confirmLabel }))?.[o.field.name] ?? null;
export const askPassword = (o: { title: string; message?: string; minLength?: number; confirmLabel?: string; hint?: string }) =>
  askText({ title: o.title, message: o.message, confirmLabel: o.confirmLabel, field: { name: "password", label: "Password", type: "password", minLength: o.minLength, autoComplete: o.minLength ? "new-password" : "current-password", hint: o.hint } });
export const askConfirm = (o: { title: string; message: string; confirmLabel?: string; danger?: boolean }) =>
  new Promise<boolean>((resolve) => enqueue({ kind: "confirm", confirmLabel: "Continue", ...o, resolve }));
export const tellUser = (title: string, message: string) =>
  new Promise<void>((resolve) => enqueue({ kind: "alert", title, message, resolve }));
