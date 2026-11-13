"use client";
import { askConfirm, tellUser } from "@/lib/readwind/dialogs";
import { lazy, Suspense, useEffect, useState } from "react";
import type { Anchor } from "@/lib/readwind/types";
import { useLibrary, useFullBook } from "@/lib/readwind/useLibrary";
import type { AuthClient } from "@/lib/readwind/useLibrary";
import { Library } from "./Library";
import { MotionConfig, motion } from "motion/react";
import { ReadwindLockup } from "./Logo";
import { Interactions } from "./Fx";
import { Modal } from "./Modal";
import { labelAt } from "@/lib/readwind/anchors";
import { AudiobookProvider } from "./Audiobook";

// Each route and rarely-opened dialog is its own chunk, so the shelf paints
// without parsing the reader, importer, notebook or stats code first. The
// service worker precaches every chunk, so this stays offline-safe.
const BookReader = lazy(() => import("./BookReader").then((m) => ({ default: m.BookReader })));
const Notebook = lazy(() => import("./Notebook").then((m) => ({ default: m.Notebook })));
const Import = lazy(() => import("./Import").then((m) => ({ default: m.Import })));
const Discover = lazy(() => import("./Discover").then((m) => ({ default: m.Discover })));
const ReadingStats = lazy(() => import("./ReadingStats").then((m) => ({ default: m.ReadingStats })));
const Profile = lazy(() => import("./Profile").then((m) => ({ default: m.Profile })));
type User = { id: string; name: string; email: string };
function AuthForm({
  auth,
  onSuccess,
  onClose,
}: {
  auth: AuthClient | null;
  onSuccess: (u: User) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<
      "signin" | "signup" | "forgot" | "verify" | "reset" | "reset-code"
    >("signin"),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [info, setInfo] = useState("");
  const [resetToken, setResetToken] = useState('');
  useEffect(() => {
    // URL is only readable on the client, so this is read after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (new URLSearchParams(location.search).has("token")) setMode("reset");
    const fragment = new URLSearchParams(location.hash.slice(1));
    if (fragment.get('type') === 'recovery' && fragment.get('access_token')) {
      setResetToken(fragment.get('access_token')!);
      setMode('reset');
      history.replaceState(null, '', location.pathname + location.search);
    } else if (fragment.get('error_code')) {
      setMode('forgot');
      setError('That reset link has expired or was already used. Request a new one.');
      history.replaceState(null, '', location.pathname + location.search);
    }
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!auth) return;
    setBusy(true);
    setError("");
    setInfo("");
    try {
      if (mode === "forgot") {
        const r = await auth.emailOtp.requestPasswordReset({ email });
        if (r.error) throw new Error(r.error.message);
        // The provider email carries a link, not a code.
        setInfo("If this account exists, a reset link is on its way. Open it on this device.");
        return;
      }
      if (mode === "reset-code") {
        const r = await auth.emailOtp.resetPassword({
          email,
          otp: code,
          password,
        });
        if (r.error) throw new Error(r.error.message);
        setMode("signin");
        setInfo("Password updated. You can sign in now.");
        return;
      }
      if (mode === "reset") {
        const token = resetToken || new URLSearchParams(location.search).get("token") || "";
        const r = await auth.resetPassword({ newPassword: password, token });
        if (r.error) throw new Error(r.error.message);
        const cleanUrl = new URL(location.href); cleanUrl.searchParams.delete("token");
        history.replaceState(null,"",cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
        setMode("signin");
        setInfo("Password updated. You can sign in now.");
        return;
      }
      if (mode === "verify") {
        const r = await auth.emailOtp.verifyEmail({ email, otp: code });
        if (r.error) throw new Error(r.error.message);
        setMode("signin");
        setInfo("Email verified. Sign in to open your shelf.");
        return;
      }
      const requestVerification = async (message: string) => {
        const response = await auth.emailOtp.sendVerificationOtp({ email, type: "email-verification" });
        if (response.error) throw new Error(response.error.message || "Could not send a verification code. Please retry.");
        setMode("verify");
        setInfo(message);
      };
      const result = mode === "signup"
        ? await auth.signUp.email({ name, email, password })
        : await auth.signIn.email({ email, password });
      if (result.error) {
        if (result.error.code === "EMAIL_NOT_VERIFIED") {
          await requestVerification("Enter the verification code sent to your email.");
          return;
        }
        throw new Error(result.error.message || "Could not sign in.");
      }
      const session = await auth.getSession();
      if (session.error) throw new Error(session.error.message || "Could not confirm your sign-in session. Please retry.");
      if (session.data?.user?.emailVerified) {
        onSuccess(session.data.user as User);
      } else if (session.data?.user || mode === "signup") {
        await requestVerification("Check your email for a verification code.");
      } else {
        throw new Error("Your sign-in session could not be confirmed. Please try again.");
      }
    } catch (e) {
      setError((e as Error).message || "Could not connect. Try again.");
    } finally {
      setBusy(false);
    }
  }
  const titles = {
    signin: "A shelf of your own.",
    signup: "Make yourself at home.",
    forgot: "Find your way back.",
    verify: "Check your inbox.",
    reset: "A fresh start.",
    "reset-code": "A fresh start.",
  };
  return (
    <Modal title={titles[mode]} className="auth-modal" onClose={onClose}>
      <p className="auth-intro">
        Your books, your thoughts, your place.
        <br />
        Waiting for you on every device.
      </p>
      <form onSubmit={submit} className="auth-form">
        {mode === "signup" && (
          <label>
            Your name
            <input
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          </label>
        )}
        {mode !== "reset" && (
          <label>
            Email
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
        )}
        {["signin", "signup", "reset", "reset-code"].includes(mode) && (
          <label>
            Password
            <input
              required
              type="password"
              minLength={mode === "signin" ? 1 : 12}
              maxLength={128}
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        {(mode === "verify" || mode === "reset-code") && (
          <label>
            Verification code
            <input
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {info && (
          <p role="status" className="form-info">
            {info}
          </p>
        )}
        {!auth && (
          <p className="form-error">
            Account service is not available yet. Please try again shortly.
          </p>
        )}
        <button className="button primary" disabled={busy || !auth}>
          {busy
            ? "One moment…"
            : {
                signin: "Sign in",
                signup: "Create your account",
                forgot: "Send reset link",
                verify: "Verify email",
                reset: "Save new password",
                "reset-code": "Save new password",
              }[mode]}
        </button>
      </form>
      <div className="auth-links">
        {mode === "signin" ? (
          <>
            <button
              onClick={() => {
                setMode("signup");
                setError("");
              }}
            >
              New here? Create an account
            </button>
            <button onClick={() => setMode("forgot")}>Forgot password?</button>
          </>
        ) : (
          <button
            onClick={() => {
              setMode("signin");
              setError("");
            }}
          >
            Back to sign in
          </button>
        )}
      </div>
    </Modal>
  );
}
function Workspace({
  user,
  auth,
  navigate,
  path,
  onAccount,
  onSignOut,
  catalogEnabled,
}: {
  user: User | null;
  auth: AuthClient | null;
  navigate: (path: string) => void;
  path: string;
  onAccount: () => void;
  onSignOut: () => Promise<void>;
  catalogEnabled: boolean;
}) {
  const library = useLibrary(user?.id || "preview", auth),
    [file, setFile] = useState<File | null>(null),
    [stats, setStats] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(()=>{
    const id=requestAnimationFrame(()=>{ const heading=document.querySelector<HTMLElement>('h1, main, [role="main"]'); if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});} });
    return ()=>cancelAnimationFrame(id);
  },[path]);
  const match = path.match(/^\/book\/([^/]+)(\/notebook)?/),
    shelfBook = match
      ? library.books.find((b) => b.id === decodeURIComponent(match[1]))
      : undefined,
    // The reader needs the text, which the shelf rows leave out, so it loads just this book.
    fullBook = useFullBook(library, shelfBook?.id),
    book = fullBook && fullBook.id === shelfBook?.id ? fullBook : undefined;
  async function jump(b: { id: string }, at: Anchor) {
    await library.saveProgress(b.id, at, 0);
    navigate(`/book/${b.id}`);
  }
  function onFile(f: File) {
    if (!/\.(pdf|epub)$/i.test(f.name) && !['application/pdf','application/epub+zip'].includes(f.type)) {
      setNotice("Choose a PDF or EPUB file to import.");
      return;
    }
    setFile(f);
    navigate("/import");
  }
  const openAccount = () => (user ? navigate("/profile") : onAccount());
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      if (["localhost", "127.0.0.1"].includes(location.hostname)) {
        navigator.serviceWorker
          .getRegistrations()
          .then((regs) => regs.forEach((r) => r.unregister()))
          .catch(() => {});
        caches
          .keys()
          .then((keys) =>
            keys
              .filter((k) => k.startsWith("folio-"))
              .forEach((k) => caches.delete(k)),
          )
          .catch(() => {});
      } else navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return (
    <AudiobookProvider library={library} path={path} navigate={navigate}>
      <span className="sr-only" role="status" aria-live="polite">{shelfBook ? shelfBook.title : path.includes("notebook") ? "Notebook" : path === "/profile" ? "Profile" : path.includes("collections") ? "Collections" : "Library"}</span>
      <Suspense fallback={null}>
      {match && book ? (
        match[2] ? (
          <Notebook
            library={library}
            book={book}
            navigate={navigate}
            onJump={(b, at) => void jump(b, at)}
          />
        ) : (
          <BookReader
            key={book.id}
            book={book}
            library={library}
            navigate={navigate}
          />
        )
      ) : path === "/notebook" ? (
        <Notebook
          library={library}
          navigate={navigate}
          onJump={(b, at) => void jump(b, at)}
        />
      ) : path === "/profile" ? (
        <Profile
          library={library}
          user={user}
          auth={auth}
          navigate={navigate}
          onStats={() => setStats(true)}
          onSignIn={onAccount}
          onSignOut={onSignOut}
          onNotice={setNotice}
        />
      ) : path === '/discover' ? <Discover key={library.db.name} library={library} navigate={navigate}/> : path === "/import" ? (
        <Import
          key={file?.name || "new"}
          library={library}
          navigate={navigate}
          initialFile={file}
        />
      ) : match && library.ready ? (
        <main className="not-found">
          <h1>This book isn’t on your shelf.</h1>
          <p>
            Sign in with the account that imported it, or return to your
            library.
          </p>
          <button className="button primary" onClick={() => navigate("/")}>
            Back to library
          </button>
        </main>
      ) : (
        <Library
          library={library}
          navigate={navigate}
          onFile={onFile}
          onAccount={openAccount}
          onStats={() => setStats(true)}
          name={user?.name}
          catalogEnabled={catalogEnabled}
          view={path === "/collections" ? "collections" : "library"}
        />
      )}
      </Suspense>
      {notice && (
        <button className="toast" onClick={() => setNotice("")}>
          {notice}
        </button>
      )}
      {library.conflict && (
        <Modal title="You’ve been reading elsewhere." onClose={() => {}}>
          <p>
            Your other device has a newer saved place. Choose where you’d like
            to continue.
          </p>
          <div className="conflict-options">
            <button
              className="button primary"
              onClick={() => void library.resolveConflict(false)}
            >
              Resume from other device · p.{" "}
              {book ? labelAt(book, library.conflict.remote.at) : ""}
            </button>
            <button
              className="button"
              onClick={() => void library.resolveConflict(true)}
            >
              Keep this device’s place · p.{" "}
              {book ? labelAt(book, library.conflict.local.at) : ""}
            </button>
          </div>
        </Modal>
      )}
      {stats && (
        <Suspense fallback={null}>
          <ReadingStats library={library} onClose={() => setStats(false)} />
        </Suspense>
      )}
    </AudiobookProvider>
  );
}
export default function ReadwindApp() {
  const [auth, setAuth] = useState<AuthClient | null>(null),
    [user, setUser] = useState<User | null>(null),
    [path, setPath] = useState("/"),
    [showAuth, setShowAuth] = useState(false),
    [catalogEnabled,setCatalogEnabled] = useState(false),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    // A reset email lands on the home page with the result in the URL; open the form that handles it.
    const fragment = new URLSearchParams(location.hash.slice(1));
    if (fragment.get("type") === "recovery" || fragment.get("error_code") || new URLSearchParams(location.search).has("token"))
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowAuth(true);
  }, []);
  const navigate = (url: string) => {
    history.pushState(null, "", url);
    setPath(url.split("?")[0]);
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    let alive = true;
    // Location is only readable on the client, so the path is synced after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPath(location.pathname);
    if (new URLSearchParams(location.search).has("reset")) setShowAuth(true);
    const loadAuth = () => fetch("/api/config")
      .then((r) => r.json() as Promise<{ authUrl: string | null;catalogEnabled?:boolean }>)
      .then(async (config) => {
        if(alive)setCatalogEnabled(config.catalogEnabled===true);
        if (!config.authUrl) return;
        const { createReadwindAuth } = await import("@/lib/readwind/auth");
        const client = createReadwindAuth();
        if (!alive) return;
        setAuth(() => client);
        const session = await client.getSession();
        if(session.error){if(navigator.onLine && alive)setUser(null);throw new Error("Could not validate the account session.");}
        if (alive && session.data?.user?.emailVerified) {
          const u = session.data.user as User;
          setUser(u);
          sessionStorage.setItem("folio-offline-user", JSON.stringify({...u, offlineUntil:Date.now()+86400000}));
          if(localStorage.getItem("readwind-offline-enabled")==="true")localStorage.setItem("folio-offline-user",JSON.stringify({...u,offlineUntil:Date.now()+30*86400000}));
        } else if (alive && !session.error) {
          sessionStorage.removeItem("folio-offline-user");
          localStorage.removeItem("folio-offline-user");
          setUser(null);
        }
      })
      .catch(() => {
        if (!navigator.onLine) {
          try {
            const u = JSON.parse(
              localStorage.getItem("folio-offline-user") || sessionStorage.getItem("folio-offline-user") || "null",
            );
            if (alive && typeof u?.id==='string' && u?.offlineUntil > Date.now()) {setUser(u);setAuth(null);}
          } catch {}
        }
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    void loadAuth();
    const reconnect = () => void loadAuth();
    window.addEventListener("online", reconnect);
    const pop = () => setPath(location.pathname);
    window.addEventListener("popstate", pop);
    return () => {
      alive = false;
      window.removeEventListener("popstate", pop);
      window.removeEventListener("online", reconnect);
    };
  }, []);
  async function signedIn(u: User) {
    // Guest imports cross an account boundary only after an explicit choice.
    const { ReadwindDB } = await import("@/lib/readwind/db");
    const preview = new ReadwindDB("preview");
    const hasImports = await preview.books.filter(b=>!b.sample).count();
    preview.close();
    if (hasImports && await askConfirm({title:"Bring your guest books along?",message:"Copy this device's guest books and notes into your account?",confirmLabel:"Copy them"})) {
      const { migratePreview } = await import("@/lib/readwind/migrate-preview");
      await migratePreview(u.id);
    }
    setUser(u);
    sessionStorage.setItem("folio-offline-user", JSON.stringify({...u, offlineUntil:Date.now()+86400000}));
          if(localStorage.getItem("readwind-offline-enabled")==="true")localStorage.setItem("folio-offline-user",JSON.stringify({...u,offlineUntil:Date.now()+30*86400000}));
    setShowAuth(false);
    navigate("/");
  }
  async function signOut() {
    if(!auth)throw new Error('Reconnect and sign in before signing out, or lock offline access by disabling it in your account.');
    const {ReadwindDB}=await import('@/lib/readwind/db');
    const before=user?new ReadwindDB(user.id):null;
    try{if(before && await before.pending.count())throw new Error('Another tab has pending changes. Sync that tab before signing out.');}finally{before?.close();}
    const result = await auth.signOut();
    if (result?.error) throw new Error(result.error.message || 'Could not sign out.');
    sessionStorage.removeItem("folio-offline-user");
    localStorage.removeItem("folio-offline-user");
    localStorage.removeItem("readwind-offline-enabled");
    const previous = user?.id;
    setUser(null);
    if (previous) {
      const { ReadwindDB } = await import("@/lib/readwind/db");
      const cached = new ReadwindDB(previous);
      const cleared=await cached.transaction("rw",cached.tables,async()=>{
        if(await cached.pending.count())return false;
        for(const table of cached.tables)await table.clear();
        return true;
      });
      cached.close();
      if(!cleared)void tellUser('Signed out','Newer changes from another tab were retained privately on this device. Sign back into the same account to sync them.');
      // Recovery archives retain their owner-scoped safety copy until explicitly retired.
    }
    navigate("/");
  }
  if (!loaded)
    return (
      <MotionConfig reducedMotion="user">
        <motion.div
          className="opening-screen"
          initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="wordmark">
            <ReadwindLockup height={44} />
          </div>
          <p>Read slowly. Wind down.</p>
        </motion.div>
      </MotionConfig>
    );
  return (
    <MotionConfig reducedMotion="user">
      <Interactions />
      <Workspace
        key={user?.id || "preview"}
        user={user}
        catalogEnabled={catalogEnabled}
        auth={auth}
        navigate={navigate}
        path={path}
        onAccount={() => setShowAuth(true)}
        onSignOut={signOut}
      />
      {showAuth && (
        <AuthForm
          auth={auth}
          onSuccess={(u) => void signedIn(u)}
          onClose={() => setShowAuth(false)}
        />
      )}
    </MotionConfig>
  );
}
