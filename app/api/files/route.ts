import { owner, storageFetch, unauthorized } from "@/lib/readwind/server";
export async function POST(request: Request) {
  const user = await owner(request);
  if (!user) return unauthorized();
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^[a-zA-Z0-9_-]{1,120}$/.test(id))
    return Response.json({ error: "Invalid file ID" }, { status: 400 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > 50 * 1024 * 1024)
    return Response.json(
      { error: "PDFs must be under 50 MB." },
      { status: 413 },
    );
  const type =
    request.headers.get("content-type") || "application/octet-stream";
  if (type !== "application/pdf" && !type.startsWith("image/"))
    return Response.json({ error: "Unsupported file type" }, { status: 415 });
  const response = await storageFetch(`${user}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": type },
    body: bytes,
  });
  if (!response.ok)
    return Response.json(
      { error: "File upload failed. Please retry." },
      { status: 502 },
    );
  return Response.json({ ok: true });
}
export async function GET(request: Request) {
  const user = await owner(request);
  if (!user) return unauthorized();
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^[a-zA-Z0-9_-]{1,120}$/.test(id))
    return new Response(null, { status: 400 });
  try {
    const result = await storageFetch(`${user}/${id}`);
    if (!result.ok)
      return Response.json({ error: "File unavailable" }, { status: 404 });
    return new Response(result.body, {
      headers: {
        "Content-Type":
          result.headers.get("content-type") || "application/octet-stream",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "File unavailable" }, { status: 404 });
  }
}
