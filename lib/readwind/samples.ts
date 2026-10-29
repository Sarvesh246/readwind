import walden from "./walden.json";
import type { Book, Annotation } from "./types";
export const sampleBooks: Book[] = [
  walden as Book,
  ...[
    [
      "meditations",
      "Meditations",
      "Marcus Aurelius",
      "#6E2F2A",
      "#F1E4D6",
      "Book II",
      "Begin the morning by saying to thyself, I shall meet with the busy-body, the ungrateful, arrogant, deceitful, envious, unsocial. All these things happen to them by reason of their ignorance of what is good and evil.",
      "Remember how long thou hast been putting off these things, and how often thou hast received an opportunity from the gods, and yet dost not use it.",
    ],
    [
      "art-of-war",
      "The Art of War",
      "Sun Tzu",
      "#8A5A2B",
      "#F6EBD9",
      "Laying Plans",
      "Sun Tzu said: The art of war is of vital importance to the State. It is a matter of life and death, a road either to safety or to ruin. Hence it is a subject of inquiry which can on no account be neglected.",
      "All warfare is based on deception. Hence, when able to attack, we must seem unable; when using our forces, we must seem inactive; when we are near, we must make the enemy believe we are far away.",
    ],
    [
      "odyssey",
      "The Odyssey",
      "Homer",
      "#23344F",
      "#E8E1D2",
      "Book I",
      "Tell me, O muse, of that ingenious hero who travelled far and wide after he had sacked the famous town of Troy. Many cities did he visit, and many were the nations with whose manners and customs he was acquainted.",
      "He suffered much by sea while trying to save his own life and bring his men safely home; but do what he might he could not save his men, for they perished through their own sheer folly.",
    ],
    [
      "frankenstein",
      "Frankenstein",
      "Mary Shelley",
      "#3A3633",
      "#E9E2D6",
      "Letter I",
      "You will rejoice to hear that no disaster has accompanied the commencement of an enterprise which you have regarded with such evil forebodings. I arrived here yesterday, and my first task is to assure my dear sister of my welfare and increasing confidence in the success of my undertaking.",
      "I am already far north of London, and as I walk in the streets of Petersburgh, I feel a cold northern breeze play upon my cheeks, which braces my nerves and fills me with delight.",
    ],
    [
      "pride",
      "Pride and Prejudice",
      "Jane Austen",
      "#C9B48A",
      "#2A2622",
      "Chapter 1",
      "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.",
      "However little known the feelings or views of such a man may be on his first entering a neighbourhood, this truth is so well fixed in the minds of the surrounding families, that he is considered the rightful property of some one or other of their daughters.",
    ],
  ].map(([id, title, author, color, fg, chapter, ...paras], i) => ({
    id: `sample-${id}`,
    title,
    author,
    cover: { kind: "typeset" as const, color, fg },
    addedAt: 1793203200000 - i - 1,
    lastOpenedAt: 1793203200000 - i - 1,
    printPageCount: 1,
    sample: true,
    sections: [
      {
        id: "section-0",
        title: chapter,
        heading: true,
        blocks: paras.map((text) => ({ type: "p" as const, text })),
      },
    ],
    pageMarks: [
      { label: "1", index: 0, at: { section: 0, block: 0, offset: 0 } },
    ],
  })),
];
export function sampleAnnotations(): Annotation[] {
  return [
    [
      "Simplicity, simplicity, simplicity!",
      "yellow",
      "Same idea as the “fewer, better” rule for side projects — pick two, finish them.",
    ],
    ["I went to the woods because I wished to live deliberately,", "blue", ""],
    [
      "Our life is frittered away by detail.",
      "green",
      "Connects to Meditations, Book IV.",
    ],
  ].map(([phrase, color, note], i) => {
    let at = { section: 0, block: 0, offset: 0 };
    const b = sampleBooks[0];
    b.sections.forEach((s, section) =>
      s.blocks.forEach((p, block) => {
        const offset = (p.text || "").indexOf(phrase);
        if (offset >= 0) at = { section, block, offset };
      }),
    );
    return {
      id: `sample-highlight-${i}`,
      bookId: b.id,
      kind: "highlight",
      range: { start: at, end: { ...at, offset: at.offset + phrase.length } },
      quote: phrase,
      color: color as Annotation["color"],
      note,
      createdAt: 1793062800000 + i,
      updatedAt: 1793062800000 + i,
      review: { due: 0, interval: 0 },
    };
  });
}
