import { HttpError, safeId } from "./security";

function endpoint() {
  const base = process.env.SUPABASE_URL,
    token = process.env.READWIND_STORAGE_TOKEN;
  if (!base || !token) throw new Error("Supabase storage is not configured");
  return {
    base: base.replace(/\/$/, "") + "/functions/v1/readwind-storage",
    token,
  };
}
function validateKey(key: string) {
  const parts = key.split("/");
  if (parts.length !== 2 || parts.some((part) => !safeId.test(part)))
    throw new HttpError(400, "Invalid storage path.");
}
export function supabaseStorageFetch(key: string, init: RequestInit = {}) {
  validateKey(key);
  const { base, token } = endpoint(),
    url = new URL(base);
  url.searchParams.set("key", key);
  const headers = new Headers(init.headers);
  headers.set("x-readwind-storage-token", token);
  return fetch(url, {
    ...init,
    headers,
    cache: "no-store",
    redirect: "error",
    signal: init.signal || AbortSignal.timeout(30000),
  });
}
export async function supabaseStoragePresign(
  key: string,
  type: string,
  bytes?: number,
  origin?: string,
) {
  validateKey(key);
  if (!bytes || !origin)
    throw new Error("Upload length and origin are required");
  const { base, token } = endpoint();
  const response = await fetch(base + "?action=sign", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-readwind-storage-token": token,
    },
    body: JSON.stringify({ key, type, bytes, origin }),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new HttpError(503, "Could not prepare the file upload.");
  return response.json() as Promise<{
    url: string;
    headers: Record<string, string>;
    expires: number;
  }>;
}
export async function supabaseSessionLive(
  sessionId: string,
  authUserId: string,
) {
  const { base, token } = endpoint();
  const response = await fetch(base + "?action=live-session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-readwind-storage-token": token,
    },
    body: JSON.stringify({ session_id: sessionId, auth_user_id: authUserId }),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new HttpError(
      503,
      "Could not verify your sign-in session. Please retry.",
    );
  return (await response.json()) === true;
}

export async function finishAccountDeletion(authUserId:string) {
 const {base,token}=endpoint();
 const result=await fetch(base+'?action=delete-account',{method:'POST',headers:{'Content-Type':'application/json','x-readwind-storage-token':token},body:JSON.stringify({authUserId}),signal:AbortSignal.timeout(30000)});
 if(!result.ok)throw new HttpError(503,'Account deletion is pending. Retry to finish removing the identity.');
}

export async function pruneEphemeral() {
 const {base,token}=endpoint();
 const response=await fetch(base+'?action=maintenance',{method:'POST',headers:{'x-readwind-storage-token':token},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new HttpError(503,'Maintenance could not finish.');
 return response.json();
}
