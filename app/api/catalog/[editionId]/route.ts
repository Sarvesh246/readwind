import { catalogVersion, preparedBook } from "@/lib/readwind/catalog-server";
import { safeRoute } from "@/lib/readwind/security";
export const GET = safeRoute(
  async (
    request: Request,
    { params }: { params: Promise<{ editionId: string }> },
  ) => {
    const { editionId } = await params,
      row = await catalogVersion(editionId);
    return Response.json(
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
