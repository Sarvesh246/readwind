import { z } from "zod";
import { safeId } from "./security";
export const timestamp = z.number().int().min(0).max(8640000000000000);
export const anchor = z.object({
  section: z.number().int().min(0).max(1999),
  block: z.number().int().min(0).max(19999),
  offset: z.number().int().min(0).max(200000),
});
export const book = z
  .object({
    id: z.string().regex(safeId),
    title: z.string().max(200000).min(1).max(500),
    author: z.string().max(200000).max(500),
    sections: z
      .array(
        z.object({
          id: z.string().max(120),
          title: z.string().max(5000),
          heading: z.boolean(),
          blocks: z
            .array(
              z.discriminatedUnion("type", [
                z.object({
                  type: z.enum(["p", "h", "quote"]),
                  text: z.string().max(200000),
                  footnoteRefs: z
                    .array(
                      z.object({
                        at: z.number().int().min(0).max(200000),
                        noteId: z.string().max(120),
                      }),
                    )
                    .max(2000)
                    .optional(),
                }),
                z.object({
                  type: z.literal("figure"),
                  blobId: z.string().regex(safeId),
                  text: z.string().max(200000).optional(),
                  caption: z.string().max(200000).optional(),
                }),
              ]),
            )
            .min(1)
            .max(20000),
        }),
      )
      .min(1)
      .max(2000),
    pageMarks: z
      .array(
        z.object({
          label: z.string().max(120),
          index: z.number().int().min(0).max(9999),
          at: anchor,
        }),
      )
      .max(10000),
    cover: z.object({
      kind: z.enum(["typeset", "pdfPage", "image"]),
      color: z
        .string()
        .max(200000)
        .regex(/^#[0-9a-f]{6}$/i),
      fg: z.string().regex(/^#[0-9a-f]{6}$/i),
      blobId: z.string().regex(safeId).optional(),
    }),
    pdfCoverBlobId: z.string().regex(safeId).optional(),
    customCoverBlobId: z.string().regex(safeId).optional(),
    addedAt: timestamp,
    lastOpenedAt: timestamp,
    printPageCount: z.number().int().positive().max(10000),
    sourcePdfBlobId: z.string().regex(safeId).optional(),
    sample: z.boolean().optional(),
    readingMode: z.enum(["original", "reflow"]).optional(),
    importReport: z
      .object({
        version: z.literal(1),
        recommendedMode: z.enum(["original", "reflow"]),
        warnings: z.array(z.string().max(2000)).max(10000),
        pages: z
          .array(
            z.object({
              index: z.number().int().min(0),
              width: z.number().positive(),
              height: z.number().positive(),
              ocrConfidence: z.number().min(0).max(100).optional(),
              characters: z.number().int().min(0).max(1000000),
              issues: z
                .array(
                  z.enum([
                    "columns",
                    "rotated-text",
                    "rtl",
                    "vertical-text",
                    "scanned",
                    "text-mapping",
                    "sparse",
                    "illustrated",
                    "low-ocr",
                    "extraction-error",
                  ]),
                )
                .max(11),
            }),
          )
          .max(10000),
      })
      .optional(),
    footnotes: z
      .array(
        z.object({
          id: z.string().max(120),
          marker: z.string().max(120),
          text: z.string().max(200000),
          pageIndex: z.number().int().min(0).max(9999),
        }),
      )
      .max(20000)
      .optional(),
  })
  .superRefine((book, ctx) => {
    if (book.sections.reduce((n, s) => n + s.blocks.length, 0) > 100000)
      ctx.addIssue({ code: "custom", message: "Too many blocks" });
    for (const mark of book.pageMarks) {
      const block = book.sections[mark.at.section]?.blocks[mark.at.block];
      if (
        !block ||
        mark.at.offset > (block.text?.length || 0) ||
        mark.index >= book.printPageCount
      )
        ctx.addIssue({ code: "custom", message: "Invalid page anchor" });
    }
  });
export const progress = z.object({
  bookId: z.string().regex(safeId),
  at: anchor,
  deviceId: z.string().regex(safeId),
  wordsRead: z.number().int().min(0).max(10000000),
  revision: z.number().int().min(0).max(2147483646),
});
export const annotation = z.object({
  id: z.string().regex(safeId),
  bookId: z.string().regex(safeId),
  kind: z.enum(["highlight", "bookmark"]),
  range: z.object({ start: anchor, end: anchor }),
  color: z.enum(["yellow", "green", "blue", "pink"]),
  quote: z.string().max(50000),
  note: z.string().max(20000),
  createdAt: timestamp,
  updatedAt: timestamp,
  deleted: z.boolean().optional(),
  pdfRange: z
    .object({
      pageIndex: z.number().int().min(0),
      rects: z
        .array(
          z.object({
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
            width: z.number().min(0).max(1),
            height: z.number().min(0).max(1),
          }),
        )
        .max(2000),
    })
    .optional(),
  review: z
    .object({ due: z.number(), interval: z.number().int().min(0).max(35) })
    .optional(),
});
export const settings = z.object({
  paper: z.enum(["Paper", "Sepia", "Dusk", "Night"]),
  font: z.enum(["Literata", "Source Serif", "Atkinson"]),
  size: z.number().min(14).max(28),
  spacing: z.enum(["Snug", "Normal", "Airy"]),
  turn: z.enum(["Curl", "Slide", "Scroll"]),
  wideLayout: z.enum(["spread", "single"]),
  warmLight: z.boolean(),
  restNudge: z.boolean(),
  focusParagraph: z.boolean(),
  colorNames: z.object({
    yellow: z.string().max(80),
    green: z.string().max(80),
    blue: z.string().max(80),
    pink: z.string().max(80),
  }),
});
