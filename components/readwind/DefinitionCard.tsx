"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { cleanWord, wordsOf, type Entry } from "@/lib/readwind/dictionary";
import { Icon } from "./Icon";

type Result = { status: "loading" } | { status: "found"; entry: Entry } | { status: "missing" } | { status: "error" };
const cache = new Map<string, Entry | null>();
const pending = new Map<string, Promise<Entry | null>>();

async function define(term: string): Promise<Entry | null> {
  const key = term.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;
  let request = pending.get(key);
  if (!request) {
    request = fetch(`/api/define?word=${encodeURIComponent(term)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("lookup failed");
        const data = (await r.json()) as { found?: boolean; entry?: Entry };
        const entry = data.found && data.entry ? data.entry : null;
        cache.set(key, entry);
        return entry;
      })
      .finally(() => pending.delete(key));
    pending.set(key, request);
  }
  return request;
}

function speak(entry: Entry) {
  if (entry.audio) {
    new Audio(entry.audio).play().catch(() => speakText(entry.lemma || entry.word));
    return;
  }
  speakText(entry.lemma || entry.word);
}
function speakText(text: string) {
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en";
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  } catch {}
}

const POS: Record<string, string> = { adj: "adjective", adv: "adverb", prep: "preposition", conj: "conjunction", interj: "interjection", pron: "pronoun" };

export function DefinitionCard({ quote, dock = "bottom" }: { quote: string; dock?: "top" | "bottom" }) {
  const words = useMemo(() => wordsOf(quote), [quote]);
  const phrase = useMemo(() => (words.length > 1 && words.length <= 4 ? cleanWord(quote) : null), [quote, words]);
  const longest = useMemo(() => [...words].sort((a, b) => b.length - a.length)[0] || "", [words]);
  const start = phrase || longest;
  const [trail, setTrail] = useState<string[]>([]);
  const [term, setTerm] = useState(start);
  const [fellBack, setFellBack] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The result is tagged with the request it answers, so a stale answer reads as "loading".
  const tag = `${term}|${attempt}`;
  const [done, setDone] = useState<{ tag: string; result: Result } | null>(null);
  const result: Result = !term ? { status: "missing" } : done?.tag === tag ? done.result : { status: "loading" };
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!term) return;
    let alive = true;
    const finish = (r: Result) => alive && setDone({ tag, result: r });
    define(term)
      .then((entry) => {
        if (!alive) return;
        if (entry) finish({ status: "found", entry });
        else if (term === phrase && longest && longest !== term) {
          setFellBack(true);
          setTerm(longest);
        } else finish({ status: "missing" });
      })
      .catch(() => finish({ status: "error" }));
    return () => {
      alive = false;
    };
  }, [term, phrase, longest, tag]);

  useEffect(() => {
    top.current?.scrollTo({ top: 0 });
  }, [term]);

  const go = (next: string) => {
    if (next.toLowerCase() === term.toLowerCase()) return;
    setTrail((t) => [...t, term]);
    setFellBack(false);
    setTerm(next);
  };
  const back = () => {
    const prev = trail[trail.length - 1];
    if (!prev) return;
    setTrail((t) => t.slice(0, -1));
    setTerm(prev);
  };
  const pickable = words.length > 1 ? words.slice(0, 8) : [];

  return (
    <section className="define-card" data-dock={dock} aria-label="Definition" aria-live="polite">
      {(trail.length > 0 || pickable.length > 0) && (
        <div className="define-bar">
          {trail.length > 0 && (
            <button type="button" className="define-back" aria-label={`Back to ${trail[trail.length - 1]}`} onClick={back}>
              <Icon name="back" size={16} />
            </button>
          )}
          {pickable.length > 0 && (
            <div className="define-words" role="group" aria-label="Words in your selection">
              {phrase && (
                <button type="button" aria-pressed={term === phrase} onClick={() => go(phrase)}>
                  Phrase
                </button>
              )}
              {pickable.map((w) => (
                <button type="button" key={w} aria-pressed={term.toLowerCase() === w} onClick={() => go(w)}>
                  {w}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="define-scroll" ref={top}>
        {result.status === "loading" && (
          <div className="define-loading" aria-label="Looking up">
            <i /> <i /> <i />
          </div>
        )}
        {result.status === "error" && (
          <p className="define-empty">
            Couldn’t reach the dictionary. Check your connection and{" "}
            <button type="button" onClick={() => setAttempt((n) => n + 1)}>
              try again
            </button>
            .
          </p>
        )}
        {result.status === "missing" && (
          <p className="define-empty">
            No entry for <strong>{term}</strong>. It may be a name or a coined word.{" "}
            <a href={`https://www.google.com/search?q=${encodeURIComponent(`define ${term}`)}`} target="_blank" rel="noreferrer noopener">
              Search the web
            </a>
          </p>
        )}
        {result.status === "found" && <Body entry={result.entry} fellBack={fellBack} phrase={phrase} onWord={go} />}
      </div>
    </section>
  );
}

function Body({ entry, fellBack, phrase, onWord }: { entry: Entry; fellBack: boolean; phrase: string | null; onWord: (w: string) => void }) {
  return (
    <>
      {fellBack && phrase && <p className="define-note">No entry for “{phrase}”, showing the word instead.</p>}
      <header className="define-head">
        <div>
          <h3>{entry.word}</h3>
          {(entry.phonetic || entry.lemma) && (
            <p>
              {entry.phonetic}
              {entry.lemma && <span className="define-lemma"> · form of {entry.lemma}</span>}
            </p>
          )}
        </div>
        <button type="button" className="define-speak" aria-label={`Hear ${entry.word}`} onClick={() => speak(entry)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 9.500v5h3.500L12 18.500v-13L7.500 9.500z" />
            <path d="M15.500 9a4 4 0 0 1 0 6M18 6.500a7.500 7.500 0 0 1 0 11" />
          </svg>
        </button>
      </header>
      {entry.meanings.map((m) => (
        <div className="define-pos" key={m.partOfSpeech}>
          <h4>{POS[m.partOfSpeech] || m.partOfSpeech}</h4>
          <ol>
            {m.senses.map((s, i) => (
              <li key={i}>
                <span>{s.definition}</span>
                {s.example && <q>{s.example}</q>}
              </li>
            ))}
          </ol>
        </div>
      ))}
      {entry.synonyms.length > 0 && (
        <div className="define-thesaurus">
          <h4>Synonyms</h4>
          <div className="define-chips">
            {entry.synonyms.map((w) => (
              <button type="button" key={w} onClick={() => onWord(w)}>
                {w}
              </button>
            ))}
          </div>
        </div>
      )}
      {entry.antonyms.length > 0 && (
        <div className="define-thesaurus">
          <h4>Antonyms</h4>
          <div className="define-chips">
            {entry.antonyms.map((w) => (
              <button type="button" key={w} onClick={() => onWord(w)}>
                {w}
              </button>
            ))}
          </div>
        </div>
      )}
      <footer className="define-source">From {entry.sources.join(" · ")}</footer>
    </>
  );
}
