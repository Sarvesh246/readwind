/**
 * Dictionary + thesaurus lookup that blends several open sources so far more words resolve:
 *  - Free Dictionary API (curated senses, phonetics, audio)
 *  - Wiktionary (huge coverage: rare words, idioms, inflected forms)
 *  - Datamuse (thesaurus: synonyms and antonyms for almost any word)
 * Everything here is pure; the route injects a fetcher so it can be tested offline.
 */
export type Sense = { definition: string; example?: string };
export type Meaning = { partOfSpeech: string; senses: Sense[] };
export type Entry = {
  word: string;
  /** The form that was actually looked up when it differs from the selection ("running" → "run"). */
  lemma?: string;
  phonetic?: string;
  audio?: string;
  meanings: Meaning[];
  synonyms: string[];
  antonyms: string[];
  sources: string[];
};
export type Fetcher = (url: string) => Promise<unknown | null>;

const MAX_MEANINGS = 5;
const MAX_SENSES = 4;

/** Normalises a selection into something we can look up, or null when it isn't a word. */
export function cleanWord(raw: string): string | null {
  const text = raw
    .normalize("NFC")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (!text || text.length > 60 || !/\p{L}/u.test(text)) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N}' -]*$/u.test(text)) return null;
  return text;
}

/** Tokens of a selection, longest first, for letting readers choose a word out of a phrase. */
export function wordsOf(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of raw.split(/\s+/)) {
    const w = cleanWord(piece)?.toLowerCase();
    if (w && !seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
  }
  return out;
}

/** Likely dictionary headwords for an inflected form, most plausible first. */
export function candidates(word: string): string[] {
  const out: string[] = [];
  const add = (w: string) => {
    if (w.length >= 2 && !out.includes(w)) out.push(w);
  };
  add(word);
  const lower = word.toLowerCase();
  add(lower);
  if (/\s/.test(lower)) return out.slice(0, 4);
  const w = lower.replace(/'s$/, "").replace(/s'$/, "s").replace(/n't$/, "");
  add(w);
  if (/ies$/.test(w)) add(w.slice(0, -3) + "y");
  if (/ied$/.test(w)) add(w.slice(0, -3) + "y");
  if (/(ches|shes|sses|xes|zes|oes)$/.test(w)) add(w.slice(0, -2));
  if (/s$/.test(w) && !/ss$/.test(w)) add(w.slice(0, -1));
  if (/ing$/.test(w) && w.length > 5) {
    const stem = w.slice(0, -3);
    add(stem);
    add(stem + "e");
    if (/(.)\1$/.test(stem)) add(stem.slice(0, -1));
  }
  if (/ed$/.test(w) && w.length > 4) {
    const stem = w.slice(0, -2);
    add(stem);
    add(stem + "e");
    add(w.slice(0, -1));
    if (/(.)\1$/.test(stem)) add(stem.slice(0, -1));
  }
  if (/ly$/.test(w) && w.length > 4) {
    add(w.slice(0, -2));
    if (/ily$/.test(w)) add(w.slice(0, -3) + "y");
  }
  if (/est$/.test(w) && w.length > 5) {
    add(w.slice(0, -3));
    add(w.slice(0, -2));
  }
  if (/er$/.test(w) && w.length > 4) {
    add(w.slice(0, -2));
    add(w.slice(0, -1));
  }
  return out.slice(0, 8);
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
};
export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown) => (Array.isArray(v) ? v : []);

function normalisePos(pos: string) {
  const p = pos.toLowerCase().trim();
  return p === "proper noun" ? "noun" : p;
}

export function parseFreeDictionary(json: unknown): Entry | null {
  const first = list(json).find(isObj);
  if (!first) return null;
  const phonetics = list(first.phonetics).filter(isObj);
  const phonetic = str(first.phonetic) || phonetics.map((p) => str(p.text)).find(Boolean) || undefined;
  const audio = phonetics.map((p) => str(p.audio)).find((a) => /^https:\/\//.test(a)) || undefined;
  const meanings = new Map<string, Meaning>();
  const synonyms: string[] = [];
  const antonyms: string[] = [];
  for (const entry of list(json).filter(isObj)) {
    for (const m of list(entry.meanings).filter(isObj)) {
      const pos = normalisePos(str(m.partOfSpeech));
      if (!pos) continue;
      const target = meanings.get(pos) || { partOfSpeech: pos, senses: [] };
      for (const d of list(m.definitions).filter(isObj)) {
        const definition = str(d.definition);
        if (!definition) continue;
        target.senses.push({ definition, example: str(d.example) || undefined });
        synonyms.push(...list(d.synonyms).map(str));
        antonyms.push(...list(d.antonyms).map(str));
      }
      synonyms.push(...list(m.synonyms).map(str));
      antonyms.push(...list(m.antonyms).map(str));
      if (target.senses.length) meanings.set(pos, target);
    }
  }
  if (!meanings.size) return null;
  return {
    word: str(first.word),
    phonetic,
    audio,
    meanings: [...meanings.values()],
    synonyms: unique(synonyms),
    antonyms: unique(antonyms),
    sources: ["Free Dictionary"],
  };
}

export function parseWiktionary(json: unknown, word: string): Entry | null {
  if (!isObj(json)) return null;
  const groups = list(json.en).filter(isObj);
  const meanings = new Map<string, Meaning>();
  for (const g of groups) {
    const pos = normalisePos(str(g.partOfSpeech));
    if (!pos) continue;
    const target = meanings.get(pos) || { partOfSpeech: pos, senses: [] };
    for (const d of list(g.definitions).filter(isObj)) {
      const definition = stripHtml(str(d.definition));
      if (definition.length < 3) continue;
      const ex = list(d.parsedExamples).filter(isObj).map((e) => stripHtml(str(e.example))).find(Boolean);
      target.senses.push({ definition, example: ex || undefined });
    }
    if (target.senses.length) meanings.set(pos, target);
  }
  if (!meanings.size) return null;
  return { word, meanings: [...meanings.values()], synonyms: [], antonyms: [], sources: ["Wiktionary"] };
}

export function parseDatamuse(json: unknown): string[] {
  return unique(list(json).filter(isObj).map((w) => str(w.word)));
}

function unique(words: string[]) {
  const seen = new Set<string>();
  return words
    .map((w) => w.replace(/\s+/g, " ").trim())
    .filter((w) => {
      const key = w.toLowerCase();
      if (!w || w.length > 40 || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

const sameSense = (a: string, b: string) => a.toLowerCase().slice(0, 40) === b.toLowerCase().slice(0, 40);

/** Curated senses lead; the wider source fills in missing parts of speech and thin entries. */
export function mergeEntries(primary: Entry | null, secondary: Entry | null): Entry | null {
  if (!primary || !secondary) return primary || secondary;
  const meanings = primary.meanings.map((m) => ({ ...m, senses: [...m.senses] }));
  for (const extra of secondary.meanings) {
    const found = meanings.find((m) => m.partOfSpeech === extra.partOfSpeech);
    if (!found) {
      meanings.push({ ...extra, senses: [...extra.senses] });
      continue;
    }
    for (const s of extra.senses) {
      if (found.senses.length >= 3) break;
      if (!found.senses.some((x) => sameSense(x.definition, s.definition))) found.senses.push(s);
    }
  }
  return {
    ...primary,
    meanings,
    synonyms: unique([...primary.synonyms, ...secondary.synonyms]),
    antonyms: unique([...primary.antonyms, ...secondary.antonyms]),
    sources: unique([...primary.sources, ...secondary.sources]),
  };
}

const INFLECTION =
  /\b(?:simple past|past tense|past participle|present participle|plural|third-person singular|comparative|superlative|gerund|alternative (?:form|spelling)|inflection)\b[^.;]{0,60}?\bof\s+([\p{L}][\p{L}'-]*)/iu;
/** The base word when an entry just says "past tense of run", else undefined. */
export function baseForm(entry: Entry): string | undefined {
  for (const m of entry.meanings)
    for (const s of m.senses.slice(0, 2)) {
      const hit = s.definition.match(INFLECTION);
      if (hit) return hit[1].toLowerCase();
    }
  return undefined;
}

const enc = encodeURIComponent;
export const sources = {
  free: (w: string) => `https://api.dictionaryapi.dev/api/v2/entries/en/${enc(w)}`,
  wiktionary: (w: string) => `https://en.wiktionary.org/api/rest_v1/page/definition/${enc(w.replace(/ /g, "_"))}`,
  synonyms: (w: string) => `https://api.datamuse.com/words?rel_syn=${enc(w)}&max=16`,
  antonyms: (w: string) => `https://api.datamuse.com/words?rel_ant=${enc(w)}&max=8`,
};

/** Resolves a word, trying inflection-stripped forms until a source knows it. */
export async function lookup(raw: string, get: Fetcher): Promise<Entry | null> {
  const word = cleanWord(raw);
  if (!word) return null;
  for (const form of candidates(word)) {
    const [free, wikt] = await Promise.all([get(sources.free(form)), get(sources.wiktionary(form))]);
    const entry = mergeEntries(parseFreeDictionary(free), parseWiktionary(wikt, form));
    if (!entry) continue;
    // An inflected entry ("simple past of run") borrows its base word's thesaurus.
    const base = baseForm(entry);
    const thesaurus = base && base.toLowerCase() !== form.toLowerCase() ? base : form;
    const [syn, ant] = await Promise.all([get(sources.synonyms(thesaurus)), get(sources.antonyms(thesaurus))]);
    const skip = new Set([form.toLowerCase(), thesaurus.toLowerCase(), word.toLowerCase()]);
    const synonyms = unique([...entry.synonyms, ...parseDatamuse(syn)]).filter((s) => !skip.has(s.toLowerCase()));
    const antonyms = unique([...entry.antonyms, ...parseDatamuse(ant)]).filter((s) => !skip.has(s.toLowerCase()));
    const lemma = form.toLowerCase() === word.toLowerCase() ? (thesaurus !== form ? thesaurus : undefined) : form;
    return {
      ...entry,
      word: word,
      lemma,
      meanings: entry.meanings.slice(0, MAX_MEANINGS).map((m) => ({ ...m, senses: m.senses.slice(0, MAX_SENSES) })),
      synonyms: synonyms.slice(0, 14),
      antonyms: antonyms.slice(0, 8),
      sources: unique([...entry.sources, ...(syn || ant ? ["Datamuse"] : [])]),
    };
  }
  // No definition anywhere: a thesaurus entry alone is still useful for rare words.
  const syn = parseDatamuse(await get(sources.synonyms(word)));
  if (syn.length)
    return { word, meanings: [], synonyms: syn.slice(0, 14), antonyms: [], sources: ["Datamuse"] };
  return null;
}
