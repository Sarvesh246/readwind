export type Anchor = { section: number; block: number; offset: number };
export type Block =
  | {
      type: "p" | "h" | "quote";
      text: string;
      footnoteRefs?: { at: number; noteId: string }[];
    }
  | { type: "figure"; blobId: string; caption?: string; text?: string };
export type Section = {
  id: string;
  title: string;
  heading: boolean;
  blocks: Block[];
};
export type PageMark = { label: string; index: number; at: Anchor };
export type Book = {
  id: string;
  title: string;
  author: string;
  addedAt: number;
  lastOpenedAt: number;
  cover: {
    color: string;
    fg: string;
    kind: "typeset" | "pdfPage";
    blobId?: string;
  };
  printPageCount: number;
  sections: Section[];
  pageMarks: PageMark[];
  sourcePdfBlobId?: string;
  sample?: boolean;
  revision?: number;
  readingMode?: 'original'|'reflow';
  importReport?: import('./pdf-layout').PdfImportReport;
  footnotes?: { id: string; marker: string; text: string; pageIndex: number }[];
};
export type Annotation = {
  id: string;
  bookId: string;
  kind: "highlight" | "bookmark";
  range: { start: Anchor; end: Anchor };
  color: Color;
  quote: string;
  note: string;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
  pdfRange?: {pageIndex:number;rects:{x:number;y:number;width:number;height:number}[]};
  review?: { due: number; interval: number };
};
export type Color = "yellow" | "green" | "blue" | "pink";
export type Progress = {
  bookId: string;
  at: Anchor;
  updatedAt: number;
  revision: number;
  wordsRead: number;
  deviceId: string;
};
export type Settings = {
  paper: "Paper" | "Sepia" | "Dusk" | "Night";
  font: "Literata" | "Source Serif" | "Atkinson";
  size: number;
  spacing: "Snug" | "Normal" | "Airy";
  turn: "Curl" | "Slide" | "Scroll";
  wideLayout: "spread" | "single";
  warmLight: boolean;
  restNudge: boolean;
  focusParagraph: boolean;
  colorNames: Record<Color, string>;
};
export const defaults: Settings = {
  paper: "Paper",
  font: "Literata",
  size: 18,
  spacing: "Normal",
  turn: "Curl",
  wideLayout: "spread",
  warmLight: true,
  restNudge: true,
  focusParagraph: false,
  colorNames: {
    yellow: "Ideas",
    green: "Agree",
    blue: "Quotes",
    pink: "Question",
  },
};
export const colors: Record<Color, string> = {
  yellow: "#F3DE8A",
  green: "#C8DDB0",
  blue: "#BCD3E8",
  pink: "#EFC6C6",
};
export const families = {
  Literata: "Literata, Georgia, serif",
  "Source Serif": '"Source Serif 4", Georgia, serif',
  Atkinson: '"Atkinson Hyperlegible", sans-serif',
};
export const leading = { Snug: 1.45, Normal: 1.66, Airy: 1.9 };
export const themes = {
  Paper: {
    desk: "#D8D0C0",
    page: "#F6F0E3",
    ink: "#2A2622",
    muted: "#6B6358",
    edge: "#DCD2BF",
    chip: "#E6DECF",
    on: "#F6F0E3",
    inside: "#E9E0CB",
    accent: "#2E4A6E",
    shade: "40,28,14",
    hlYellow: "#F3DE8A",
    hlBlue: "#CFE0EE",
  },
  Sepia: {
    desk: "#C9B794",
    page: "#EEDFC2",
    ink: "#3B2F22",
    muted: "#665440",
    edge: "#D6C29D",
    chip: "#D8C7A6",
    on: "#EEDFC2",
    inside: "#E2CFA9",
    accent: "#4A3A26",
    shade: "60,42,22",
    hlYellow: "#E8CB72",
    hlBlue: "#C9D5D6",
  },
  Dusk: {
    desk: "#1F1D1B",
    page: "#2E2B27",
    ink: "#D6CDBD",
    muted: "#A69C8B",
    edge: "#3E3934",
    chip: "#2C2926",
    on: "#3A3631",
    inside: "#262320",
    accent: "#9DBBE0",
    shade: "0,0,0",
    hlYellow: "rgba(230,200,100,.30)",
    hlBlue: "rgba(140,175,215,.28)",
  },
  Night: {
    desk: "#0B0A09",
    page: "#161412",
    ink: "#ABA293",
    muted: "#8C8476",
    edge: "#26221F",
    chip: "#1A1816",
    on: "#2A2622",
    inside: "#100F0D",
    accent: "#8FA9C9",
    shade: "0,0,0",
    hlYellow: "rgba(230,200,100,.22)",
    hlBlue: "rgba(140,175,215,.20)",
  },
};
