declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): void;
};
const serverTokenHash =
  "e06df2a20f618cebbf7ff7fff6164c685d22162df953f37bffc1369003aec162";
const base = Deno.env.get("SUPABASE_URL")!;
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const encoder = new TextEncoder();
const types = new Set([
  "application/pdf",
  "application/epub+zip",
  "text/plain",
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const pathPattern = /^(catalog|[a-zA-Z0-9_-]{1,120})\/[a-zA-Z0-9_-]{1,120}$/;
const digest = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
const signingKey = crypto.subtle.importKey(
  "raw",
  encoder.encode(service),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign", "verify"],
);
const encode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
const decode = (text: string) =>
  Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );
type Grant = {
  key: string;
  type: string;
  bytes: number;
  expires: number;
  origin: string;
};
async function readBody(request: Request, limit: number) {
  const claimed = request.headers.get("content-length");
  if (claimed && (!/^\d+$/.test(claimed) || Number(claimed) > limit))
    throw new Error("Too large");
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = request.body?.getReader();
  if (reader)
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > limit) {
        await reader.cancel();
        throw new Error("Too large");
      }
      chunks.push(part.value);
    }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const part of chunks) {
    bytes.set(part, at);
    at += part.length;
  }
  return bytes;
}
function responseHeaders(response: Response) {
  const headers = new Headers({ "Cache-Control": "private, no-store" });
  for (const name of [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "etag",
  ]) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}
async function store(
  key: string,
  request: Request,
  method: string,
  bytes?: Uint8Array,
  type?: string,
) {
  const headers = new Headers({
    apikey: service,
    Authorization: "Bearer " + service,
    "Accept-Encoding": "identity",
  });
  let target = base + "/storage/v1/object/folio-books/" + key,
    body: BodyInit | undefined;
  if (method === "DELETE") {
    target = base + "/storage/v1/object/folio-books";
    headers.set("Content-Type", "application/json");
    body = JSON.stringify({ prefixes: [key] });
  }
  if (method === "PUT") {
    method = "POST";
    headers.set("x-upsert", "true");
    headers.set("Content-Type", type || "application/octet-stream");
    body = bytes as BodyInit;
  }
  const range = request.headers.get("range");
  if (range) headers.set("Range", range);
  const upstream = await fetch(target, { method, headers, body });
  return new Response(method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers: responseHeaders(upstream),
  });
}
async function uploadAllowed(grant:Grant){
 const [file_owner,file_id]=grant.key.split('/');
 const response=await fetch(base+'/rest/v1/rpc/readwind_upload_allowed',{method:'POST',headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},body:JSON.stringify({file_owner,file_id,file_bytes:grant.bytes}),signal:AbortSignal.timeout(10000)});
 return response.ok && await response.json()===true;
}
Deno.serve(async (request) => {
  try {
    const url = new URL(request.url),
      upload = url.searchParams.get("upload");
    if (upload) {
      const [payload, signature, ...rest] = upload.split(".");
      if (
        rest.length ||
        !payload ||
        !signature ||
        !(await crypto.subtle.verify(
          "HMAC",
          await signingKey,
          decode(signature),
          encoder.encode(payload),
        ))
      )
        return new Response("Invalid upload grant", { status: 403 });
      const grant = JSON.parse(
        new TextDecoder().decode(decode(payload)),
      ) as Grant;
      if (
        !pathPattern.test(grant.key) ||
        !types.has(grant.type) ||
        !Number.isInteger(grant.bytes) ||
        grant.bytes < 1 ||
        grant.bytes > 20971520 ||
        grant.expires < Date.now() ||
        grant.expires > Date.now() + 301000 ||
        request.headers.get("origin") !== grant.origin
      )
        return new Response("Expired or invalid upload grant", { status: 403 });
      const cors = {
        "Access-Control-Allow-Origin": grant.origin,
        "Access-Control-Allow-Methods": "PUT, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        Vary: "Origin",
      };
      if (request.method === "OPTIONS")
        return new Response(null, { status: 204, headers: cors });
      if (
        request.method !== "PUT" ||
        request.headers.get("content-type") !== grant.type
      )
        return new Response("Invalid upload request", {
          status: 400,
          headers: cors,
        });
      const bytes = await readBody(request, grant.bytes);
      if (bytes.length !== grant.bytes)
        return new Response("File size mismatch", {
          status: 400,
          headers: cors,
        });
      if(!await uploadAllowed(grant))return new Response('Upload reservation expired or account deletion started',{status:410,headers:cors});
      const response = await store(
        grant.key,
        request,
        "PUT",
        bytes,
        grant.type,
      );
      if(response.ok && !await uploadAllowed(grant)){await store(grant.key,request,'DELETE');return new Response('Upload cancelled during account deletion',{status:410,headers:cors});}
      for (const [key, value] of Object.entries(cors))
        response.headers.set(key, value);
      return response;
    }
    if (
      (await digest(request.headers.get("x-readwind-storage-token") || "")) !==
      serverTokenHash
    )
      return new Response("Unauthorized", { status: 401 });
    if (
      url.searchParams.get("action") === "live-session" &&
      request.method === "POST"
    ) {
      const input = JSON.parse(
        new TextDecoder().decode(await readBody(request, 1024)),
      );
      if (
        !/^[0-9a-f-]{36}$/i.test(input.session_id) ||
        !/^[0-9a-f-]{36}$/i.test(input.auth_user_id)
      )
        return new Response("Invalid session", { status: 400 });
      const checked = await fetch(base + "/rest/v1/rpc/readwind_session_live", {
        method: "POST",
        headers: {
          apikey: service,
          Authorization: "Bearer " + service,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });
      return new Response(checked.body, {
        status: checked.status,
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Type": "application/json",
        },
      });
    }
    if(url.searchParams.get('action')==='maintenance' && request.method==='POST'){
      const result=await fetch(base+'/rest/v1/rpc/readwind_prune_ephemeral',{method:'POST',headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)});
      return new Response(result.body,{status:result.status,headers:{'Cache-Control':'no-store','Content-Type':'application/json'}});
    }
    if(url.searchParams.get('action')==='delete-account' && request.method==='POST'){
      const input=JSON.parse(new TextDecoder().decode(await readBody(request,1024))) as {authUserId:string};
      if(!/^[0-9a-f-]{36}$/i.test(input.authUserId))return new Response('Invalid user',{status:400});
      const headers={apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'};
      const purge=await fetch(base+'/rest/v1/rpc/readwind_delete_account_data',{method:'POST',headers,body:JSON.stringify({auth_user:input.authUserId,finished:false}),signal:AbortSignal.timeout(10000)});
      if(!purge.ok || await purge.json()!==true)return new Response('Deletion was not requested or files remain',{status:409});
      const removed=await fetch(base+'/auth/v1/admin/users/'+input.authUserId,{method:'DELETE',headers,signal:AbortSignal.timeout(10000)});
      if(!removed.ok && removed.status!==404)return new Response('Identity deletion pending',{status:503});
      const finish=await fetch(base+'/rest/v1/rpc/readwind_delete_account_data',{method:'POST',headers,body:JSON.stringify({auth_user:input.authUserId,finished:true}),signal:AbortSignal.timeout(10000)});
      return new Response(null,{status:finish.ok?204:503});
    }
    if (
      url.searchParams.get("action") === "sign" &&
      request.method === "POST"
    ) {
      const input = JSON.parse(
        new TextDecoder().decode(await readBody(request, 2048)),
      ) as Grant;
      if (
        !pathPattern.test(input.key) ||
        !types.has(input.type) ||
        !Number.isInteger(input.bytes) ||
        input.bytes < 1 ||
        input.bytes > 20971520 ||
        !/^https?:\/\//.test(input.origin) ||
        new URL(input.origin).origin !== input.origin
      )
        return new Response("Invalid upload parameters", { status: 400 });
      input.expires = Date.now() + 300000;
      const payload = encode(encoder.encode(JSON.stringify(input))),
        signature = encode(
          new Uint8Array(
            await crypto.subtle.sign(
              "HMAC",
              await signingKey,
              encoder.encode(payload),
            ),
          ),
        );
      const signed = new URL(base + "/functions/v1/readwind-storage");
      signed.searchParams.set("upload", payload + "." + signature);
      return Response.json(
        {
          url: signed.href,
          headers: { "Content-Type": input.type },
          expires: 300,
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const key = url.searchParams.get("key") || "";
    if (
      !pathPattern.test(key) ||
      !["GET", "HEAD", "PUT", "DELETE"].includes(request.method)
    )
      return new Response("Invalid storage request", { status: 400 });
    const bytes =
      request.method === "PUT" ? await readBody(request, 20971520) : undefined;
    return await store(
      key,
      request,
      request.method,
      bytes,
      request.headers.get("content-type") || undefined,
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error && error.message === "Too large"
            ? "File exceeds its upload limit."
            : "Storage request failed.",
      },
      {
        status:
          error instanceof Error && error.message === "Too large" ? 413 : 503,
      },
    );
  }
});
