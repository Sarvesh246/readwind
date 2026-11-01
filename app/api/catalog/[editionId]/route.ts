import { catalogVersion, preparedBook } from "@/lib/readwind/catalog-server";
import { safeRoute } from "@/lib/readwind/security";
import { streamJson } from "@/lib/readwind/json-stream";
export const GET = safeRoute(
  async (
    request: Request,
    { params }: { params: Promise<{ editionId: string }> },
  ) => {
    const { editionId } = await params,
      row = await catalogVersion(editionId);
    return streamJson(
      {
        entry: row.entry,
        ...(new URL(request.url).searchParams.has("content")
          ? { book: await preparedBook(row) }
          : {}),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  },
);
