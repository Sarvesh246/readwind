"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { AudioLines, Bookmark, BookOpen, Headphones, ListMusic, Loader2, Moon, Pause, Play, RotateCcw, RotateCw, SkipBack, SkipForward, X } from "lucide-react";
import type { Anchor, Book, ListenSettings } from "@/lib/readwind/types";
import { listenDefaults } from "@/lib/readwind/types";
import type { Library } from "@/lib/readwind/useLibrary";
import { labelAt, wordProgress } from "@/lib/readwind/anchors";
import {
  ListenCredit,
  VOICE_WPM,
  anchorOf,
  chapterRange,
  chapters,
  chunkAt,
  formatClock,
  formatDuration,
  nextChapter,
  previousChapter,
  scriptOf,
  secondsFor,
  skipBy,
  voiceWpm,
  type Chunk,
  type Script,
} from "@/lib/readwind/speech";
import { Cover } from "./Library";
import { cancelClips, cancelDownload, downloadNaturalVoice, downloadedVoices, generateClip, naturalVoiceSupported, refreshDownloadedVoices, removeNaturalVoice, resetNaturalVoice, warmNaturalVoice, type ClipRequest } from "@/lib/readwind/natural-voice";
import { VoiceSettings } from "./VoiceSettings";
import { DEFAULT_NATURAL_VOICE, isNaturalVoice, naturalVoice } from "@/lib/readwind/voices";
import { Modal } from "./Modal";

export const RATES = [0.8, 1, 1.2, 1.5, 1.75, 2];
const SLEEP_MINUTES = [15, 30, 45];
/** A pause between chapters, so the next title doesn't run into the last line. */
const CHAPTER_GAP_MS = 900;
/** Seconds of natural speech kept ready ahead of the voice. */
const PREFETCH_SECONDS = 60;
/** Waiting this long for the next natural sentence counts as the phone falling behind. */
const UNDERRUN_MS = 2500;
/** How long the system voice gets to make a sound before we say it didn't. */
const SYSTEM_START_TIMEOUT_MS = 4000;
/** Silence, played inside the first tap to unlock audio on iOS. */
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
const SAVE_EVERY_MS = 15000;
/** The last stretch of a sleep timer is read a little softer and slower. */
const WIND_DOWN_MS = 10000;

type Sleep = { kind: "time"; until: number; minutes: number } | { kind: "chapter"; section: number } | null;
type VoiceInfo = { uri: string; name: string; lang: string; local: boolean };

type Audiobook = {
  supported: boolean;
  book: Book | null;
  script: Script | null;
  index: number;
  chunk: Chunk | null;
  playing: boolean;
  /** Source range of the word being spoken, when the voice reports word boundaries. */
  word: { start: number; end: number } | null;
  notice: string;
  sleep: Sleep;
  sleepLeft: number;
  settings: ListenSettings;
  voices: VoiceInfo[];
  voice: VoiceInfo | null;
  wpm: number;
  sheet: boolean;
  /** Starts (or resumes) `book` from `at`, or from its saved place. */
  play: (book: Book, at?: Anchor) => void;
  toggle: () => void;
  pause: () => void;
  stop: () => void;
  seek: (index: number) => void;
  skip: (seconds: number) => void;
  previous: () => void;
  next: () => void;
  setRate: (rate: number) => void;
  setVoice: (uri: string) => void;
  preview: (uri: string, text: string) => void;
  setSleep: (sleep: "off" | "chapter" | number) => void;
  setHighlight: (mode: ListenSettings["highlight"]) => void;
  setReadCaptions: (on: boolean) => void;
  bookmark: () => void;
  openSheet: (open: boolean) => void;
  engine: "natural" | "system";
  /** Waiting for the natural voice to finish the next sentence. */
  buffering: boolean;
  /** The Piper download in progress (or the last one that failed), if any. */
  download: { voice: string | null; state: "idle" | "loading" | "error"; progress: number; error?: string };
  /** Piper voices that are fully on this device. */
  downloaded: string[];
  /** The Piper voice that reads when the natural engine is on. */
  naturalVoiceId: string;
  voicePanel: boolean;
  openVoicePanel: (open: boolean) => void;
  chooseEngine: (engine: "natural" | "system") => void;
  downloadNatural: (id: string) => void;
  cancelDownload: () => void;
  removeNatural: (id?: string) => void;
  /** Chooses a downloaded Piper voice and turns the natural engine on, in one saved change. */
  selectNaturalVoice: (id: string) => void;
  previewNatural: (id: string, text: string) => Promise<void>;
  dismissNotice: () => void;
};

const AudiobookContext = createContext<Audiobook | null>(null);
export const useAudiobook = () => useContext(AudiobookContext);

/** What is reading, in a few words: "Alan · Piper", "Samantha · Device", or a prompt to choose. */
export function voiceLabel(a: Audiobook) {
  if (a.engine === "natural") return `${naturalVoice(a.naturalVoiceId).name} · Piper`;
  if (a.settings.engine === "system" || (a.settings.engine === "natural" && !a.downloaded.length)) return `${a.voice?.name.split(/[ (]/)[0] || "Device"} · Device voice`;
  return "Not chosen yet";
}

const deviceLang = () => (typeof navigator === "undefined" ? "en" : (navigator.language || "en").split("-")[0].toLowerCase());
const voiceKey = (uri: string) => `readwind-voice-wpm:${uri}`;
const readNumber = (key: string) => {
  try {
    const n = Number(localStorage.getItem(key));
    return Number.isFinite(n) && n > 60 && n < 400 ? n : 0;
  } catch {
    return 0;
  }
};
const writeNumber = (key: string, value: number) => {
  try {
    localStorage.setItem(key, String(Math.round(value)));
  } catch {}
};

type WakeLockLike = { released: boolean; release(): Promise<void> };
type WakeNavigator = Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockLike> } };

export function AudiobookProvider({
  library: l,
  path,
  navigate,
  children,
}: {
  library: Library;
  path: string;
  navigate: (url: string) => void;
  children: ReactNode;
}) {
  const speechOK = typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  // Read from the browser only after hydration, so the server and first client render agree.
  const supported = useSyncExternalStore(
    () => () => {},
    () => speechOK || naturalVoiceSupported(),
    () => false,
  );
  const settings = useMemo(() => ({ ...listenDefaults, ...l.settings.listen }), [l.settings.listen]);
  const [bookId, setBookId] = useState<string | null>(null);
  const book = l.books.find(b => b.id === bookId) || null;
  const script = useMemo(() => (book ? scriptOf(book, { readCaptions: settings.readCaptions }) : null), [book, settings.readCaptions]);
  const [index, setIndex] = useState(0),
    [playing, setPlaying] = useState(false),
    [word, setWord] = useState<{ start: number; end: number } | null>(null),
    [notice, setNotice] = useState(""),
    [sleep, setSleepState] = useState<Sleep>(null),
    [sleepLeft, setSleepLeft] = useState(0),
    [voices, setVoices] = useState<VoiceInfo[]>([]),
    [sheet, setSheet] = useState(false);
  const [voicePanel, setVoicePanel] = useState(false);
  const pendingPlay = useRef<{ book: Book; at?: Anchor } | null>(null);

  // The engine runs on refs so speech callbacks always see the latest state.
  const live = useRef({ book, script, index, playing, sleep, settings, token: 0, startedAt: 0, lastSave: 0, voiceWpm: VOICE_WPM, chunkStart: 0, waiting: false, engine: "system" as "natural" | "system", watchdog: 0, cancelledAt: -1e9, natural: DEFAULT_NATURAL_VOICE, downloaded: [] as string[], fallback: false as false | "slow" | "error" });
  const speakRef = useRef<(i: number) => void>(() => {});
  // Persisted values flow in only when they change, so a just-chosen rate is not undone by a stale render.
  useEffect(() => {
    live.current.settings = settings;
  }, [settings]);
  useEffect(() => {
    live.current.sleep = sleep;
  }, [sleep]);
  useEffect(() => {
    if (book) {
      live.current.book = book;
      live.current.script = script;
    }
  }, [book, script]);
  const credit = useRef(new ListenCredit());
  const gap = useRef(0);

  useEffect(() => {
    if (!speechOK) return;
    const load = () =>
      setVoices(
        speechSynthesis.getVoices().map(v => ({ uri: v.voiceURI, name: v.name, lang: v.lang, local: v.localService })),
      );
    load();
    speechSynthesis.addEventListener("voiceschanged", load);
    return () => speechSynthesis.removeEventListener("voiceschanged", load);
  }, [speechOK]);

  const lang = deviceLang();
  const voice = useMemo(() => {
    const chosen = voices.find(v => v.uri === settings.voiceByLang[lang]);
    if (chosen) return chosen;
    const matching = voices.filter(v => v.lang.toLowerCase().startsWith(lang));
    return matching.find(v => v.local) || matching[0] || voices[0] || null;
  }, [voices, settings.voiceByLang, lang]);
  const learned = voice ? readNumber(voiceKey(voice.uri)) : 0;
  useEffect(() => {
    live.current.voiceWpm = learned || VOICE_WPM;
  }, [learned]);
  const wpm = voiceWpm(settings.rate, script?.density || 1, learned || VOICE_WPM);

  // Merges over the latest values, not the last render's, so two changes made in one tap both survive.
  const saveSettings = useCallback(
    (patch: Partial<ListenSettings>) => {
      live.current.settings = { ...live.current.settings, ...patch };
      void l.saveSettings({ ...l.settings, listen: live.current.settings }).catch(() => {});
    },
    [l],
  );

  const flushCredit = useCallback(() => {
    const c = credit.current.flush();
    if (c) void l.recordActivity(c).catch(() => {});
  }, [l]);

  const savePlace = useCallback(
    (force = false) => {
      const { book, script, index } = live.current;
      const chunk = script?.chunks[index];
      if (!book || !chunk) return;
      const now = Date.now();
      if (!force && now - live.current.lastSave < SAVE_EVERY_MS) return;
      live.current.lastSave = now;
      const at = anchorOf(chunk);
      void l.saveProgress(book.id, at, wordProgress(book, at).before).catch(() => {});
    },
    [l],
  );

  // Which engine speaks: the natural (on-device Piper) voice once one is downloaded, else the system voice.
  // A device too slow for the natural voice falls back for the rest of the session; a one-off failure only
  // until the next time the listener presses play.
  const [fallback, setFallbackState] = useState<false | "slow" | "error">(false);
  const setFallback = useCallback((value: false | "slow" | "error") => {
    live.current.fallback = value;
    setFallbackState(value);
  }, []);
  const [buffering, setBuffering] = useState(false);
  const [downloaded, setDownloaded] = useState<string[]>(() => (typeof window === "undefined" ? [] : downloadedVoices()));
  const [download, setDownload] = useState<Audiobook["download"]>({ voice: null, state: "idle", progress: 0 });
  const naturalId = isNaturalVoice(settings.naturalVoice) && downloaded.includes(settings.naturalVoice) ? settings.naturalVoice : downloaded[0] || settings.naturalVoice || DEFAULT_NATURAL_VOICE;
  const engine: "natural" | "system" = settings.engine === "natural" && !fallback && downloaded.length > 0 && naturalVoiceSupported() ? "natural" : "system";
  useEffect(() => {
    live.current.engine = engine;
  }, [engine]);
  useEffect(() => {
    live.current.natural = naturalId;
    live.current.downloaded = downloaded;
  }, [naturalId, downloaded]);
  // The browser can clear stored files when space runs low, so trust the disk over the remembered list.
  useEffect(() => {
    let alive = true;
    void refreshDownloadedVoices().then(found => alive && setDownloaded(found));
    return () => {
      alive = false;
    };
  }, []);
  /** The engine to use right now, from the latest settings and what is on the device. */
  const pickEngine = useCallback((): "natural" | "system" => {
    const c = live.current;
    return c.settings.engine === "natural" && !c.fallback && c.downloaded.length > 0 && naturalVoiceSupported() ? "natural" : "system";
  }, []);
  const audioEl = useRef<HTMLAudioElement | null>(null);
  const clips = useRef(new Map<string, ClipRequest>());
  const underruns = useRef(0);
  /** The one audio element, created and unlocked inside a tap so iOS lets it play later on its own. */
  const unlockAudio = useCallback(() => {
    if (typeof Audio === "undefined") return null;
    if (!audioEl.current) {
      const el = new Audio();
      el.preload = "auto";
      (el as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
      audioEl.current = el;
    }
    const el = audioEl.current;
    if (!el.src) {
      el.src = SILENT_WAV;
      void el.play().catch(() => {});
    }
    return el;
  }, []);
  const clipKey = (i: number) => `${live.current.natural}:${live.current.script?.chunks[i]?.say}`;
  const clipFor = useCallback((i: number) => {
    const chunk = live.current.script?.chunks[i];
    if (!chunk) return null;
    const key = clipKey(i);
    let clip = clips.current.get(key);
    if (!clip) {
      clip = generateClip(chunk.say, live.current.natural);
      clips.current.set(key, clip);
      clip.catch(() => clips.current.delete(key));
    }
    return clip;
  }, []);
  /** Keeps about a minute of speech ready ahead, so a locked screen or a slow sentence never leaves a gap. */
  const prefetch = useCallback(
    (i: number) => {
      const s = live.current.script;
      if (!s) return;
      let seconds = 0;
      for (let j = i; j < s.chunks.length && j < i + 24 && seconds < PREFETCH_SECONDS; j++) {
        void clipFor(j)?.catch(() => {});
        seconds += secondsFor(s.chunks[j].words, VOICE_WPM);
      }
      // Free clips well behind the voice.
      const keep = new Set(Array.from({ length: 30 }, (_, k) => clipKey(i - 2 + k)));
      const stale: number[] = [];
      for (const [key, clip] of clips.current)
        if (!keep.has(key)) {
          clips.current.delete(key);
          stale.push(clip.id);
          void clip.then(c => URL.revokeObjectURL(c.url)).catch(() => {});
        }
      cancelClips(stale);
    },
    [clipFor],
  );

  const halt = useCallback(() => {
    live.current.token++;
    clearTimeout(gap.current);
    clearTimeout(live.current.watchdog);
    const el = audioEl.current;
    if (el) {
      el.onended = null;
      el.onerror = null;
      el.ontimeupdate = null;
      el.pause();
    }
    // Cancelling an idle synthesizer on iOS can swallow the next speak(), so only cancel real speech.
    if (speechOK && (speechSynthesis.speaking || speechSynthesis.pending)) {
      speechSynthesis.cancel();
      live.current.cancelledAt = performance.now();
    }
  }, [speechOK]);

  const voiceFor = useCallback((uri?: string) => {
    if (!speechOK) return undefined;
    const target = uri ?? live.current.settings.voiceByLang[deviceLang()];
    const all = speechSynthesis.getVoices();
    return all.find(v => v.voiceURI === target) || all.find(v => v.voiceURI === voice?.uri);
  }, [speechOK, voice]);

  /** Stops playback and explains why, keeping the exact place. */
  const stopWith = useCallback(
    (message: string) => {
      halt();
      live.current.playing = false;
      setPlaying(false);
      setBuffering(false);
      flushCredit();
      savePlace(true);
      setNotice(message);
    },
    [halt, flushCredit, savePlace],
  );

  /** What happens after any sentence ends, whichever engine spoke it. */
  const finished = useCallback(
    (i: number, token: number, learnKey: string | null) => {
      const { script } = live.current;
      const chunk = script?.chunks[i];
      if (token !== live.current.token || !script || !chunk) return;
      const seconds = (performance.now() - (live.current.chunkStart || performance.now())) / 1000;
      // Learn this voice's real pace so time estimates match what is heard.
      if (seconds > 1.5 && chunk.words >= 6 && learnKey) {
        const measured = ((chunk.words * 60) / seconds) * Math.max(0.25, script.density) / Math.max(0.5, live.current.settings.rate);
        const next = live.current.voiceWpm * 0.85 + measured * 0.15;
        live.current.voiceWpm = next;
        writeNumber(voiceKey(learnKey), next);
      }
      const c = credit.current.add(chunk.words, seconds);
      if (c) void l.recordActivity(c).catch(() => {});
      const after = script.chunks[i + 1];
      const sleepNow = live.current.sleep;
      const timeUp = sleepNow?.kind === "time" && Date.now() >= sleepNow.until;
      const chapterUp = sleepNow?.kind === "chapter" && (!after || after.section !== sleepNow.section);
      if (timeUp || chapterUp) {
        live.current.playing = false;
        setPlaying(false);
        setSleepState(null);
        live.current.index = after ? i + 1 : i;
        setIndex(live.current.index);
        flushCredit();
        savePlace(true);
        return;
      }
      if (after && after.section !== chunk.section) {
        live.current.waiting = true;
        gap.current = window.setTimeout(() => speakRef.current(i + 1), CHAPTER_GAP_MS);
      } else speakRef.current(i + 1);
    },
    [l, flushCredit, savePlace],
  );

  const speakSystem = useCallback(
    (i: number, chunk: Chunk, token: number, winding: boolean) => {
      const u = new SpeechSynthesisUtterance(chunk.say);
      const v = voiceFor();
      if (v) {
        u.voice = v;
        u.lang = v.lang;
      }
      u.rate = live.current.settings.rate * (winding ? 0.92 : 1);
      u.volume = winding ? 0.6 : 1;
      let started = false;
      u.onstart = () => {
        started = true;
        if (token === live.current.token) live.current.chunkStart = performance.now();
      };
      u.onboundary = e => {
        if (token !== live.current.token || e.name !== "word" || live.current.settings.highlight !== "word") return;
        const from = chunk.map[e.charIndex];
        if (from === undefined || chunk.kind !== "text") return;
        const length = e.charLength || chunk.say.slice(e.charIndex).search(/\s|$/);
        const to = chunk.map[Math.min(chunk.map.length - 1, e.charIndex + Math.max(1, length) - 1)] + 1;
        setWord({ start: from, end: to });
      };
      u.onend = () => finished(i, token, v?.voiceURI || null);
      u.onerror = e => {
        if (token !== live.current.token || e.error === "interrupted" || e.error === "canceled") return;
        stopWith("The voice stopped unexpectedly. Press play to continue.");
      };
      // Some iPhones accept speak() and then never make a sound; say so instead of looking broken.
      live.current.watchdog = window.setTimeout(() => {
        if (token === live.current.token && !started && live.current.playing)
          stopWith(
            naturalVoiceSupported()
              ? "Your iPhone didn’t start its voice. Check the Silent switch, or turn on Natural voices in voice settings."
              : "Your device didn’t start its voice. Check its volume and Silent switch, then press play.",
          );
      }, SYSTEM_START_TIMEOUT_MS);
      // Right after a cancel, iOS drops an immediate speak(); a beat later it is heard.
      const sinceCancel = performance.now() - live.current.cancelledAt;
      if (sinceCancel < 120) setTimeout(() => token === live.current.token && speechSynthesis.speak(u), 120 - sinceCancel);
      else speechSynthesis.speak(u);
    },
    [voiceFor, finished, stopWith],
  );

  /** Hands the rest of the book to the device voice after the natural voice has failed for good. */
  const toSystem = useCallback(
    (i: number, reason: "slow" | "error", message: string) => {
      setBuffering(false);
      if (!speechOK) {
        stopWith("The natural voice stopped and this device has no other voice. Press play to try again.");
        return;
      }
      setFallback(reason);
      live.current.engine = "system";
      underruns.current = 0;
      setNotice(message);
      speakRef.current(i);
    },
    [speechOK, stopWith, setFallback],
  );

  const naturalRef = useRef<(i: number, chunk: Chunk, token: number, winding: boolean, attempt?: number) => void>(() => {});
  const speakNatural = useCallback(
    (i: number, chunk: Chunk, token: number, winding: boolean, attempt = 0) => {
      const el = unlockAudio();
      if (!el) {
        toSystem(i, "error", "This browser can’t play the natural voice, so the device voice is reading.");
        return;
      }
      const queued = clips.current.has(clipKey(i));
      const clip = clipFor(i);
      if (!clip) return;
      prefetch(i);
      const waitStarted = performance.now();
      const showWait = window.setTimeout(() => token === live.current.token && setBuffering(true), 350);
      /** One sentence failed to arrive or play: start the voice over and try it again before giving up. */
      const retry = (cancelledOnly: boolean) => {
        clearTimeout(showWait);
        clearTimeout(live.current.watchdog);
        if (token !== live.current.token) return;
        if (attempt >= 2) {
          toSystem(i, "error", "The natural voice stopped working, so the device voice is reading for now.");
          return;
        }
        // A cancelled request (a seek or voice change) leaves the voice healthy; any other failure gets a clean worker.
        if (!cancelledOnly) resetNaturalVoice();
        clips.current.delete(clipKey(i));
        setTimeout(() => token === live.current.token && naturalRef.current(i, chunk, token, winding, attempt + 1), 350 * (attempt + 1));
      };
      clip
        .then(c => {
          clearTimeout(showWait);
          if (token !== live.current.token) return;
          setBuffering(false);
          // A phone that keeps the listener waiting can't make the voice in real time: fall back.
          if (queued && performance.now() - waitStarted > UNDERRUN_MS) underruns.current++;
          if (underruns.current >= 2 || (c.load > 1.6 && i > 3 && underruns.current >= 1)) {
            toSystem(i, "slow", "This device can’t make the natural voice fast enough, so the device voice is reading for now.");
            return;
          }
          const rate = live.current.settings.rate * (winding ? 0.92 : 1);
          el.src = c.url;
          el.playbackRate = rate;
          el.volume = winding ? 0.6 : 1;
          el.ontimeupdate = () => {
            if (token !== live.current.token || live.current.settings.highlight !== "word" || chunk.kind !== "text" || !el.duration) return;
            // The model reports no word timings, so estimate them from the position in the sentence.
            const at = Math.min(chunk.say.length - 1, Math.floor((el.currentTime / el.duration) * chunk.say.length));
            const startAt = chunk.say.lastIndexOf(" ", at) + 1;
            const endAt = chunk.say.indexOf(" ", at);
            const from = chunk.map[startAt],
              to = chunk.map[(endAt < 0 ? chunk.say.length : endAt) - 1];
            if (from !== undefined && to !== undefined) setWord({ start: from, end: to + 1 });
          };
          el.onended = () => {
            clearTimeout(live.current.watchdog);
            finished(i, token, `piper:${live.current.natural}`);
          };
          // A clip the browser cannot decode would otherwise leave the book silent forever.
          el.onerror = () => retry(false);
          live.current.chunkStart = performance.now();
          // If the sentence neither ends nor errors in about twice its length, something stalled.
          clearTimeout(live.current.watchdog);
          live.current.watchdog = window.setTimeout(
            () => {
              if (token !== live.current.token || !live.current.playing) return;
              if (el.paused) stopWith("Playback was interrupted. Press play to continue.");
              else retry(false);
            },
            (c.seconds / Math.max(0.5, rate)) * 1000 * 2 + 8000,
          );
          el.play().catch(error => {
            if (token !== live.current.token) return;
            clearTimeout(live.current.watchdog);
            stopWith(error?.name === "NotAllowedError" ? "Tap play to keep listening." : "The voice couldn’t play. Press play to try again.");
          });
        })
        .catch(error => retry(error?.message === "cancelled"));
    },
    [unlockAudio, clipFor, prefetch, finished, stopWith, toSystem],
  );

  useEffect(() => {
    naturalRef.current = speakNatural;
  }, [speakNatural]);

  const speak = useCallback(
    (i: number) => {
      const { script } = live.current;
      if (!script) return;
      halt();
      live.current.waiting = false;
      const chunk = script.chunks[i];
      if (!chunk) {
        // The end of the book.
        live.current.playing = false;
        setPlaying(false);
        flushCredit();
        savePlace(true);
        setNotice("You’ve reached the end of the book.");
        return;
      }
      const token = live.current.token;
      live.current.index = i;
      setIndex(i);
      setWord(null);
      savePlace(i === 0 || chunk.section !== script.chunks[i - 1]?.section);
      const { sleep } = live.current;
      const winding = sleep?.kind === "time" && sleep.until - Date.now() < WIND_DOWN_MS;
      if (live.current.engine === "natural") speakNatural(i, chunk, token, winding);
      else if (speechOK) speakSystem(i, chunk, token, winding);
      else stopWith("This device has no voice to read with. Download the Piper voice in voice settings.");
    },
    [speechOK, halt, flushCredit, savePlace, speakNatural, speakSystem, stopWith],
  );
  useEffect(() => {
    speakRef.current = speak;
  }, [speak]);

  const pause = useCallback(() => {
    if (!live.current.playing) return;
    halt();
    live.current.playing = false;
    setPlaying(false);
    setWord(null);
    flushCredit();
    savePlace(true);
  }, [halt, flushCredit, savePlace]);

  const resume = useCallback(() => {
    if (!live.current.script) return;
    if (!live.current.settings.engine) {
      setVoicePanel(true);
      return;
    }
    // Pressing play again is a fresh start for the natural voice after a one-off failure (not after a slow device).
    if (live.current.fallback === "error") setFallback(false);
    live.current.engine = pickEngine();
    live.current.playing = true;
    setPlaying(true);
    setNotice("");
    speak(live.current.index);
  }, [speak, setFallback, pickEngine]);

  const play = useCallback(
    (target: Book, at?: Anchor) => {
      if (!supported) return;
      const s = scriptOf(target, { readCaptions: live.current.settings.readCaptions });
      if (!s.chunks.length) {
        setNotice("This book has no text to read aloud.");
        return;
      }
      if (live.current.book && live.current.book.id !== target.id) {
        pause();
        flushCredit();
      }
      const from = at || l.progress.find(p => p.bookId === target.id)?.at;
      const i = from ? Math.max(0, chunkAt(s, from)) : 0;
      if (!live.current.settings.engine) {
        // First listen: choose a voice first; the choice (a tap) starts playback.
        pendingPlay.current = { book: target, at: from };
        setVoicePanel(true);
        return;
      }
      if (live.current.fallback === "error") setFallback(false);
      live.current.engine = pickEngine();
      live.current.book = target;
      live.current.script = s;
      live.current.index = i;
      setBookId(target.id);
      setIndex(i);
      live.current.playing = true;
      setPlaying(true);
      // Chosen Piper but the browser cleared it: say why the device voice is reading.
      setNotice(live.current.settings.engine === "natural" && live.current.engine === "system" && naturalVoiceSupported() && !live.current.downloaded.length ? "The Piper voice is no longer on this device, so the device voice is reading. You can download it again in voice settings." : "");
      speak(i);
    },
    [supported, l.progress, pause, flushCredit, speak, setFallback, pickEngine],
  );

  const seek = useCallback(
    (i: number) => {
      const s = live.current.script;
      if (!s) return;
      const target = Math.max(0, Math.min(s.chunks.length - 1, i));
      live.current.index = target;
      setIndex(target);
      if (live.current.playing) speak(target);
      else savePlace(true);
    },
    [speak, savePlace],
  );

  const heard = () => (performance.now() - live.current.chunkStart) / 1000;
  const skip = useCallback(
    (seconds: number) => {
      const s = live.current.script;
      if (s) seek(skipBy(s, live.current.index, seconds, wpm));
    },
    [seek, wpm],
  );
  const previous = useCallback(() => {
    const s = live.current.script;
    if (s) seek(previousChapter(s, live.current.index, live.current.playing ? heard() : 0));
  }, [seek]);
  const next = useCallback(() => {
    const s = live.current.script;
    if (!s) return;
    const n = nextChapter(s, live.current.index);
    if (n >= 0) seek(n);
  }, [seek]);

  const stop = useCallback(() => {
    pause();
    setBookId(null);
    setSleepState(null);
    setSheet(false);
  }, [pause]);

  const toggle = useCallback(() => (live.current.playing ? pause() : resume()), [pause, resume]);

  const setRate = useCallback(
    (rate: number) => {
      live.current.settings = { ...live.current.settings, rate };
      saveSettings({ rate });
      if (live.current.engine === "natural" && audioEl.current) audioEl.current.playbackRate = rate;
      else if (live.current.playing) speak(live.current.index);
    },
    [saveSettings, speak],
  );
  const setVoice = useCallback(
    (uri: string) => {
      const voiceByLang = { ...live.current.settings.voiceByLang, [deviceLang()]: uri };
      live.current.settings = { ...live.current.settings, voiceByLang };
      saveSettings({ voiceByLang });
      if (live.current.playing) speak(live.current.index);
    },
    [saveSettings, speak],
  );
  const preview = useCallback(
    (uri: string, text: string) => {
      if (!speechOK) return;
      if (live.current.playing) pause();
      halt();
      const u = new SpeechSynthesisUtterance(text);
      const v = voiceFor(uri);
      if (v) {
        u.voice = v;
        u.lang = v.lang;
      }
      u.rate = live.current.settings.rate;
      speechSynthesis.speak(u);
    },
    [speechOK, pause, halt, voiceFor],
  );
  const previewEl = useRef<HTMLAudioElement | null>(null);
  const forgetClips = useCallback(() => {
    for (const clip of clips.current.values()) void clip.then(c => URL.revokeObjectURL(c.url)).catch(() => {});
    cancelClips([...clips.current.values()].map(c => c.id));
    clips.current.clear();
  }, []);
  /** Switches engine (inside a tap), then starts the book the first Listen was waiting on. */
  const chooseEngine = useCallback(
    (engine: "natural" | "system") => {
      saveSettings({ engine });
      setFallback(false);
      live.current.engine = pickEngine();
      underruns.current = 0;
      if (live.current.engine === "natural") void warmNaturalVoice(live.current.natural).catch(() => {});
      const waiting = pendingPlay.current;
      if (waiting && live.current.engine === engine) {
        pendingPlay.current = null;
        setVoicePanel(false);
        play(waiting.book, waiting.at);
      } else if (live.current.playing) {
        forgetClips();
        speak(live.current.index);
      }
    },
    [saveSettings, setFallback, pickEngine, play, speak, forgetClips],
  );
  const downloading = useRef<string | null>(null);
  const downloadNatural = useCallback((voice: string) => {
    if (downloading.current || !isNaturalVoice(voice)) return;
    downloading.current = voice;
    let shown = -1;
    setDownload({ voice, state: "loading", progress: 0 });
    downloadNaturalVoice(voice, (loaded, total) => {
      const progress = total ? loaded / total : 0;
      // Only repaint when the percentage changes; chunks arrive far faster than that.
      if (Math.round(progress * 100) === shown) return;
      shown = Math.round(progress * 100);
      setDownload({ voice, state: "loading", progress });
    })
      .then(() => {
        setDownloaded(downloadedVoices());
        setDownload({ voice: null, state: "idle", progress: 0 });
      })
      .catch(error => {
        const text = String(error?.message || error);
        setDownload(text === "cancelled" ? { voice: null, state: "idle", progress: 0 } : { voice, state: "error", progress: 0, error: text });
      })
      .finally(() => {
        downloading.current = null;
      });
  }, []);
  const stopDownload = useCallback(() => cancelDownload(), []);
  const removeNatural = useCallback(
    (voice?: string) => {
      if (live.current.engine === "natural" && (!voice || voice === live.current.natural)) pause();
      forgetClips();
      void removeNaturalVoice(voice).then(() => {
        const left = downloadedVoices();
        setDownloaded(left);
        live.current.downloaded = left;
        if (!left.length) {
          live.current.engine = "system";
          saveSettings({ engine: "system" });
        } else if (live.current.settings.engine === "natural" && live.current.natural === voice) {
          // The removed voice was the one reading: carry on with another downloaded voice.
          live.current.natural = left[0];
          saveSettings({ naturalVoice: left[0] });
        }
      });
    },
    [pause, forgetClips, saveSettings],
  );
  /** Chooses a downloaded Piper voice and turns the natural engine on, saved in one change. */
  const selectNaturalVoice = useCallback(
    (id: string) => {
      if (!live.current.downloaded.includes(id)) return;
      const changed = live.current.natural !== id;
      live.current.natural = id;
      saveSettings({ engine: "natural", naturalVoice: id });
      setFallback(false);
      live.current.engine = pickEngine();
      underruns.current = 0;
      if (changed) forgetClips();
      void warmNaturalVoice(id).catch(() => {});
      const waiting = pendingPlay.current;
      if (waiting) {
        pendingPlay.current = null;
        setVoicePanel(false);
        play(waiting.book, waiting.at);
      } else if (live.current.playing) speak(live.current.index);
    },
    [saveSettings, setFallback, pickEngine, forgetClips, play, speak],
  );
  const previewNatural = useCallback(
    (id: string, text: string) => {
      if (live.current.playing) pause();
      if (!live.current.downloaded.includes(id)) return Promise.reject(new Error("Download this voice first."));
      const el = (previewEl.current ??= new Audio());
      el.pause();
      el.src = SILENT_WAV;
      void el.play().catch(() => {});
      return generateClip(text, id).then(c => {
        el.src = c.url;
        el.playbackRate = live.current.settings.rate;
        el.onended = () => URL.revokeObjectURL(c.url);
        el.onerror = () => URL.revokeObjectURL(c.url);
        return el.play();
      });
    },
    [pause],
  );
  const setSleep = useCallback((value: "off" | "chapter" | number) => {
    const s = live.current.script;
    if (value === "off") setSleepState(null);
    else if (value === "chapter") setSleepState({ kind: "chapter", section: s?.chunks[live.current.index]?.section ?? 0 });
    else setSleepState({ kind: "time", until: Date.now() + value * 60000, minutes: value });
  }, []);

  const bookmark = useCallback(() => {
    const { book, script, index } = live.current;
    const chunk = script?.chunks[index];
    if (!book || !chunk) return;
    const at = anchorOf(chunk);
    const text = book.sections[chunk.section]?.blocks[chunk.block];
    const quote = text && text.type !== "figure" ? (text.text || "").slice(chunk.start, chunk.end) : chunk.say;
    void l
      .saveAnnotation({
        id: crypto.randomUUID(),
        bookId: book.id,
        kind: "bookmark",
        range: { start: at, end: at },
        color: "pink",
        quote: quote || chunk.say,
        note: "🎧 Bookmarked while listening",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .then(() => setNotice(`Bookmarked p. ${labelAt(book, at)}`))
      .catch(() => setNotice("Could not save the bookmark."));
  }, [l]);

  // Sleep countdown for the display.
  useEffect(() => {
    if (sleep?.kind !== "time") return;
    const tick = () => setSleepLeft(Math.max(0, (sleep.until - Date.now()) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sleep]);

  // iOS stops speech when the screen locks; say so plainly and keep the exact place.
  useEffect(() => {
    if (!speechOK) return;
    const back = () => {
      if (document.visibilityState !== "visible" || !live.current.playing) return;
      setTimeout(() => {
        if (!live.current.playing || live.current.engine !== "system" || live.current.waiting || speechSynthesis.speaking || speechSynthesis.pending) return;
        const chunk = live.current.script?.chunks[live.current.index];
        halt();
        live.current.playing = false;
        setPlaying(false);
        flushCredit();
        savePlace(true);
        const words = chunk?.say.split(/\s+/).slice(0, 4).join(" ") || "";
        setNotice(`Paused when your device locked. Continue from “${words}…”`);
      }, 1200);
    };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [speechOK, halt, flushCredit, savePlace]);

  // Keep the screen on while listening in the foreground.
  useEffect(() => {
    const api = (navigator as WakeNavigator).wakeLock;
    if (!playing || !api) return;
    let lock: WakeLockLike | null = null,
      stopped = false;
    const take = () => {
      if (document.visibilityState !== "visible" || (lock && !lock.released)) return;
      api
        .request("screen")
        .then(l => (stopped ? void l.release() : (lock = l)))
        .catch(() => {});
    };
    take();
    document.addEventListener("visibilitychange", take);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", take);
      void lock?.release().catch(() => {});
    };
  }, [playing]);

  // Lock-screen and headphone controls.
  const chunk = script?.chunks[index] || null;
  const section = chunk?.section ?? -1;
  useEffect(() => {
    if (!("mediaSession" in navigator) || !book) return;
    let url = "";
    const meta = (artwork: MediaImage[] = []) => {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: book.sections[section]?.title || book.title,
        artist: book.author,
        album: book.title,
        artwork,
      });
    };
    meta();
    const blob = book.cover.kind !== "typeset" ? book.cover.blobId : undefined;
    if (blob)
      void l.loadBlob(blob).then(b => {
        if (!b) return;
        url = URL.createObjectURL(b);
        meta([{ src: url, sizes: "512x768", type: b.type || "image/jpeg" }]);
      });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [book, section, l]);
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {}
    };
    if (!bookId) return;
    set("play", resume);
    set("pause", pause);
    set("stop", stop);
    set("seekbackward", () => skip(-15));
    set("seekforward", () => skip(30));
    set("previoustrack", previous);
    set("nexttrack", next);
    return () => {
      for (const a of ["play", "pause", "stop", "seekbackward", "seekforward", "previoustrack", "nexttrack"] as MediaSessionAction[]) set(a, null);
    };
  }, [bookId, resume, pause, stop, skip, previous, next]);
  useEffect(() => {
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = bookId ? (playing ? "playing" : "paused") : "none";
  }, [playing, bookId]);

  // Never leave a voice talking or credit unsaved when the app goes away.
  useEffect(
    () => () => {
      live.current.token++;
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    },
    [],
  );
  useEffect(() => {
    const hide = () => {
      flushCredit();
      savePlace(true);
    };
    window.addEventListener("pagehide", hide);
    return () => window.removeEventListener("pagehide", hide);
  }, [flushCredit, savePlace]);
  // A book removed from the shelf stops playing.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the shelf (an external store) dropped the book
    if (bookId && l.ready && !book) stop();
  }, [bookId, book, l.ready, stop]);

  const value: Audiobook = {
    supported,
    book,
    script,
    index,
    chunk,
    playing,
    word,
    notice,
    sleep,
    sleepLeft,
    settings,
    voices,
    voice,
    wpm,
    sheet,
    play,
    toggle,
    pause,
    stop,
    seek,
    skip,
    previous,
    next,
    setRate,
    setVoice,
    preview,
    setSleep,
    setHighlight: highlight => saveSettings({ highlight }),
    setReadCaptions: readCaptions => saveSettings({ readCaptions }),
    bookmark,
    openSheet: setSheet,
    engine,
    buffering,
    download,
    downloaded,
    naturalVoiceId: naturalId,
    voicePanel,
    openVoicePanel: (open: boolean) => {
      setVoicePanel(open);
      if (!open) {
        pendingPlay.current = null;
        previewEl.current?.pause();
      } else void refreshDownloadedVoices().then(setDownloaded);
    },
    chooseEngine,
    downloadNatural,
    cancelDownload: stopDownload,
    removeNatural,
    selectNaturalVoice,
    previewNatural,
    dismissNotice: () => setNotice(""),
  };
  const inReader = !!book && path === `/book/${book.id}`;
  return (
    <AudiobookContext.Provider value={value}>
      {children}
      {book && !inReader && <NowPlayingBar />}
      {book && sheet && <PlayerSheet library={l} navigate={navigate} />}
      {voicePanel && <VoiceSettings />}
      {notice && !inReader && (
        <button className="toast listen-toast" onClick={() => setNotice("")}>
          {notice}
        </button>
      )}
    </AudiobookContext.Provider>
  );
}

/** Time through the current chapter and what's left in it and in the book. */
export function useListenTimes(a: Audiobook) {
  const { script, index, wpm } = a;
  if (!script || !script.chunks.length) return null;
  const { first, last } = chapterRange(script, index);
  const chapterStart = script.before[first],
    chapterEnd = script.before[last] ?? script.totalWords,
    here = script.before[index] ?? 0;
  return {
    first,
    last,
    elapsed: secondsFor(here - chapterStart, wpm),
    chapterLeft: secondsFor(chapterEnd - here, wpm),
    chapterTotal: secondsFor(chapterEnd - chapterStart, wpm),
    bookLeft: secondsFor(script.totalWords - here, wpm),
    fraction: chapterEnd > chapterStart ? (here - chapterStart) / (chapterEnd - chapterStart) : 0,
  };
}

/** The slim bar shown on every screen while a book is loaded in the player. */
function NowPlayingBar() {
  const a = useAudiobook()!;
  const times = useListenTimes(a);
  if (!a.book) return null;
  const chapter = a.chunk ? a.book.sections[a.chunk.section]?.title : "";
  return (
    <div className="now-playing" role="region" aria-label="Now playing">
      <div className="now-playing-progress" style={{ transform: `scaleX(${times?.fraction || 0})` }} aria-hidden />
      <button className="now-playing-open" onClick={() => a.openSheet(true)} aria-label={`Open player for ${a.book.title}`}>
        <span className="now-playing-cover" style={{ background: a.book.cover.color, color: a.book.cover.fg }} aria-hidden>
          <Headphones size={16} />
        </span>
        <span className="now-playing-text">
          <strong>{a.book.title}</strong>
          <span>
            {chapter}
            {times ? ` · ${formatDuration(times.chapterLeft)} left` : ""}
          </span>
        </span>
      </button>
      <button className="now-playing-button" onClick={() => a.skip(-15)} aria-label="Back 15 seconds">
        <RotateCcw size={18} />
      </button>
      <button className="now-playing-button primary" onClick={a.toggle} aria-label={a.buffering ? "Preparing the voice" : a.playing ? "Pause" : "Play"}>
        {a.buffering ? <Loader2 size={20} className="spin" /> : a.playing ? <Pause size={20} /> : <Play size={20} />}
      </button>
      <button className="now-playing-button" onClick={a.stop} aria-label="Close player">
        <X size={18} />
      </button>
    </div>
  );
}

/** The compact pill inside the reader, above the page footer. */
export function ReaderPlayer({ hidden, following, onFollow }: { hidden: boolean; following: boolean; onFollow: () => void }) {
  const a = useAudiobook()!;
  const times = useListenTimes(a);
  // Sit just above the page footer, whichever reader layout is showing.
  const [bottom, setBottom] = useState<number | null>(null);
  useEffect(() => {
    const place = () => {
      const footer = document.querySelector(".reader .book-footer");
      const top = footer?.getBoundingClientRect().top;
      // Phones: just above the footer. Wider screens: straddling the footer's top edge, over the desk margin.
      setBottom(top ? Math.max(12, window.innerHeight - top + (window.innerWidth < 640 ? 10 : -24)) : null);
    };
    place();
    const footer = document.querySelector(".reader .book-footer");
    const ro = new ResizeObserver(place);
    if (footer) ro.observe(footer);
    window.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [hidden]);
  return (
    <>
      <div className={`reader-player ${hidden ? "is-hidden" : ""}`} role="region" aria-label="Read aloud" style={bottom === null ? undefined : { bottom }}>
        <button onClick={() => a.skip(-15)} aria-label="Back 15 seconds">
          <RotateCcw size={17} />
        </button>
        <button className="primary" onClick={a.toggle} aria-label={a.buffering ? "Preparing the voice" : a.playing ? "Pause" : "Play"}>
          {a.buffering ? <Loader2 size={19} className="spin" /> : a.playing ? <Pause size={19} /> : <Play size={19} />}
        </button>
        <button onClick={() => a.skip(30)} aria-label="Forward 30 seconds">
          <RotateCw size={17} />
        </button>
        <button className="rate" onClick={() => a.setRate(RATES[(RATES.indexOf(a.settings.rate) + 1) % RATES.length] || 1)} aria-label={`Speed ${a.settings.rate} times. Change speed`}>
          {a.settings.rate}×
        </button>
        {a.sleep && (
          <span className="reader-player-sleep" title="Sleep timer">
            <Moon size={13} />
            {a.sleep.kind === "time" ? formatClock(a.sleepLeft) : "Ch."}
          </span>
        )}
        {!following && (
          <button className="follow" onClick={onFollow}>
            Back to voice
          </button>
        )}
        <button onClick={() => a.openSheet(true)} aria-label="More listening options">
          <ListMusic size={17} />
        </button>
        <button onClick={a.stop} aria-label="Stop reading aloud">
          <X size={16} />
        </button>
      </div>
      {hidden && <div className="reader-player-line" style={{ transform: `scaleX(${times?.fraction || 0})` }} aria-hidden />}
      {a.notice && (
        <button className="toast listen-toast" onClick={a.dismissNotice}>
          {a.notice}
        </button>
      )}
    </>
  );
}

function PlayerSheet({ library: l, navigate }: { library: Library; navigate: (url: string) => void }) {
  const a = useAudiobook()!;
  const times = useListenTimes(a);
  const [scrub, setScrub] = useState<number | null>(null);
  const [view, setView] = useState<"player" | "chapters" | "voices">("player");
  const list = useMemo(() => (a.script && a.book ? chapters(a.script, a.book) : []), [a.script, a.book]);
  const current = a.chunk?.section;
  if (!a.book || !a.script || !times) return null;
  const book = a.book,
    script = a.script;
  const shown = scrub ?? a.index;
  const shownChunk = script.chunks[shown];
  const commitScrub = () => {
    if (scrub !== null) a.seek(scrub);
    setScrub(null);
  };
  const lang = deviceLang();
  const mine = a.voices.filter(v => v.lang.toLowerCase().startsWith(lang));
  const others = a.voices.filter(v => !v.lang.toLowerCase().startsWith(lang));
  const sample = a.chunk?.kind === "text" ? a.chunk.say : script.chunks.find(c => c.kind === "text")?.say || book.title;
  const voiceRow = (v: VoiceInfo) => (
    <div key={v.uri} className="voice-row" aria-current={a.voice?.uri === v.uri}>
      <button className="voice-choose" onClick={() => a.setVoice(v.uri)}>
        <strong>{v.name}</strong>
        <span>
          {v.lang}
          {v.local ? " · on this device" : " · online"}
        </span>
      </button>
      <button className="icon-button" onClick={() => a.preview(v.uri, sample)} aria-label={`Preview ${v.name}`}>
        <Play size={15} />
      </button>
    </div>
  );
  return (
    <Modal title="Listening" className="player-modal" onClose={() => a.openSheet(false)}>
      {view === "player" && (
        <div className="player">
          <div className="player-cover">
            <Cover book={book} loadBlob={l.loadBlob} className="player-cover-art" titleMax={30} />
          </div>
          <div className="player-title">
            <span className="eyebrow">{book.sections[current ?? 0]?.title}</span>
            <h2>{book.title}</h2>
            <span>{book.author}</span>
          </div>
          <div className="player-scrub">
            <input
              type="range"
              min={times.first}
              max={Math.max(times.first, times.last - 1)}
              value={shown}
              aria-label="Position in chapter"
              aria-valuetext={shownChunk ? `Page ${labelAt(book, anchorOf(shownChunk))}` : undefined}
              onChange={e => setScrub(Number(e.target.value))}
              onPointerUp={commitScrub}
              onKeyUp={commitScrub}
              onBlur={commitScrub}
              style={{ "--fill": `${times.last - 1 > times.first ? ((shown - times.first) / (times.last - 1 - times.first)) * 100 : 0}%` } as React.CSSProperties}
            />
            <div className="player-scrub-labels">
              {scrub !== null && shownChunk ? (
                <span className="player-scrub-target">
                  {book.sections[shownChunk.section]?.title} · p. {labelAt(book, anchorOf(shownChunk))}
                </span>
              ) : (
                <>
                  <span>{formatClock(times.elapsed)}</span>
                  <span>−{formatClock(times.chapterLeft)}</span>
                </>
              )}
            </div>
          </div>
          <div className="player-transport">
            <button onClick={a.previous} aria-label="Previous chapter">
              <SkipBack size={22} />
            </button>
            <button onClick={() => a.skip(-15)} aria-label="Back 15 seconds" className="labelled">
              <RotateCcw size={24} />
              <small>15</small>
            </button>
            <button className="primary" onClick={a.toggle} aria-label={a.buffering ? "Preparing the voice" : a.playing ? "Pause" : "Play"}>
              {a.buffering ? <Loader2 size={30} className="spin" /> : a.playing ? <Pause size={30} /> : <Play size={30} />}
            </button>
            <button onClick={() => a.skip(30)} aria-label="Forward 30 seconds" className="labelled">
              <RotateCw size={24} />
              <small>30</small>
            </button>
            <button onClick={a.next} aria-label="Next chapter">
              <SkipForward size={22} />
            </button>
          </div>
          <p className="player-left">{formatDuration(times.bookLeft)} left in book · {formatDuration(times.chapterLeft)} in chapter</p>
          <div className="player-section">
            <span className="player-label">Speed</span>
            <div className="chip-row is-even" role="group" aria-label="Speed">
              {RATES.map(r => (
                <button key={r} className="chip" aria-pressed={a.settings.rate === r} onClick={() => a.setRate(r)}>
                  {r}×
                </button>
              ))}
            </div>
          </div>
          <div className="player-section">
            <span className="player-label">
              <Moon size={14} /> Sleep timer
              {a.sleep?.kind === "time" && <em> · {formatClock(a.sleepLeft)}</em>}
            </span>
            <div className="chip-row" role="group" aria-label="Sleep timer">
              <button className="chip" aria-pressed={!a.sleep} onClick={() => a.setSleep("off")}>
                Off
              </button>
              {SLEEP_MINUTES.map(m => (
                <button key={m} className="chip" aria-pressed={a.sleep?.kind === "time" && a.sleep.minutes === m} onClick={() => a.setSleep(m)}>
                  {m} min
                </button>
              ))}
              <button className="chip" aria-pressed={a.sleep?.kind === "chapter"} onClick={() => a.setSleep("chapter")}>
                End of chapter
              </button>
            </div>
          </div>
          <button className="player-voice" onClick={() => a.openVoicePanel(true)} aria-label={`Reading voice: ${voiceLabel(a)}. Change voice`}>
            <AudioLines size={18} aria-hidden="true" />
            <span>
              <small>Reading voice</small>
              <strong>{voiceLabel(a)}</strong>
            </span>
            <em>Change</em>
          </button>
          <div className="player-actions">
            <button
              className="button ink"
              onClick={() => {
                a.openSheet(false);
                navigate(`/book/${book.id}`);
              }}
            >
              <BookOpen size={16} /> Show text
            </button>
            <button className="button" onClick={() => setView("chapters")}>
              <ListMusic size={16} /> Chapters
            </button>
            <button className="button" onClick={a.bookmark}>
              <Bookmark size={16} /> Bookmark
            </button>
          </div>
          <div className="player-options">
            <label className="switch-row player-toggle">
              <input type="checkbox" className="switch" checked={a.settings.highlight === "word"} onChange={e => a.setHighlight(e.target.checked ? "word" : "sentence")} />
              <span>Follow each word in the text</span>
            </label>
            <label className="switch-row player-toggle">
              <input type="checkbox" className="switch" checked={a.settings.readCaptions} onChange={e => a.setReadCaptions(e.target.checked)} />
              <span>Read figure captions</span>
            </label>
          </div>
        </div>
      )}
      {view === "chapters" && (
        <div className="player-list">
          <button className="text-button" onClick={() => setView("player")}>
            ← Player
          </button>
          <ol className="chapter-durations">
            {list.map(c => (
              <li key={c.section}>
                <button aria-current={c.section === current} onClick={() => { a.seek(c.first); setView("player"); }}>
                  <span>{c.title}</span>
                  <span>{formatDuration(secondsFor(c.words, a.wpm))}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
      {view === "voices" && (
        <div className="player-list">
          <button className="text-button" onClick={() => setView("player")}>
            ← Player
          </button>
          {!a.voices.length && <p className="muted">This device has no voices installed.</p>}
          {mine.map(voiceRow)}
          {others.length > 0 && (
            <details className="voice-others">
              <summary>Other languages ({others.length})</summary>
              {others.map(voiceRow)}
            </details>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Library and menu entry point: start or resume listening to a book. */
export function ListenButton({ book, className = "button", label = "Listen" }: { book: Book; className?: string; label?: string }) {
  const a = useAudiobook();
  if (!a?.supported) return null;
  const current = a.book?.id === book.id;
  return (
    <button
      className={className}
      onClick={e => {
        e.stopPropagation();
        if (current) a.toggle();
        else a.play(book);
      }}
      aria-label={current && a.playing ? `Pause ${book.title}` : `Listen to ${book.title}`}
    >
      {current && a.playing ? <Pause size={15} /> : <Headphones size={15} />}
      {current && a.playing ? "Pause" : label}
    </button>
  );
}
