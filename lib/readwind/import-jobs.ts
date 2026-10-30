import { z } from "zod";

// Same shape as security.ts's safeId, kept local so the client bundle stays small.
const safeId = /^[a-zA-Z0-9_-]{1,120}$/;

/**
 * Imports run in the browser that started them. The server only mirrors their
 * progress so the same account can see it from another device.
 */
export const importJobInput = z.object({
  id: z.string().regex(safeId),
  title: z.string().trim().min(1).max(200),
  percent: z.number().int().min(0).max(100),
  message: z.string().max(160),
  status: z.enum(["running", "ready", "failed"]),
  deviceId: z.string().regex(safeId),
});
export type ImportJobInput = z.infer<typeof importJobInput>;
export type ImportJob = ImportJobInput & {
  /** Seconds since the importing device last reported, measured by the server's clock. */
  age: number;
};

/** A running import that has not reported for this long is no longer being worked on. */
export const STALLED_AFTER_SECONDS = 45;
/** Jobs nobody has touched for this long are dropped by the server. */
export const EXPIRES_AFTER_MINUTES = 30;
export const MAX_ACTIVE_IMPORTS = 5;

export function importJobState(job: ImportJob): "running" | "ready" | "failed" | "interrupted" {
  if (job.status === "running" && job.age > STALLED_AFTER_SECONDS) return "interrupted";
  return job.status;
}
