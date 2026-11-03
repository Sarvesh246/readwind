"use client";
import {AccountStorage} from './AccountStorage';
import { createArchive, readBackup } from "@/lib/readwind/backup";
import { useEffect, useState } from "react";
import type { Book, Anchor } from "@/lib/readwind/types";
import { useLibrary } from "@/lib/readwind/useLibrary";
import type { AuthClient } from "@/lib/readwind/useLibrary";
import { Library } from "./Library";
import { MotionConfig, motion } from "motion/react";
import { ReadwindLockup } from "./Logo";
import { Interactions } from "./Fx";
import { BookReader } from "./BookReader";
import { Notebook } from "./Notebook";
import { Import } from "./Import";
import {Discover} from './Discover';
import {bookAssets} from '@/lib/readwind/catalog';
import { Modal } from "./Modal";
import { Icon } from "./Icon";
import { Flame } from "./Flame";
import { ReadingStats } from "./ReadingStats";
import { AppearanceControl } from "./Theme";
import { labelAt } from "@/lib/readwind/anchors";
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
function AccountPassword({ auth }: { auth: AuthClient }) {
  const [current, setCurrent] = useState(''), [next, setNext] = useState(''), [confirm, setConfirm] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  return <details><summary>Change password</summary><form className="auth-form" onSubmit={async event => {
    event.preventDefault(); setMessage('');
    if (next !== confirm) { setMessage('The new passwords do not match.'); return; }
    setBusy(true);
    try { const result = await auth.changePassword({ currentPassword: current, newPassword: next }); if (result.error) throw new Error(result.error.message || 'Could not change your password.'); setCurrent(''); setNext(''); setConfirm(''); setMessage('Password updated.'); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }}>
    <label>Current password<input type="password" autoComplete="current-password" required value={current} onChange={event => setCurrent(event.target.value)} /></label>
    <label>New password<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={next} onChange={event => setNext(event.target.value)} /></label>
    <label>Confirm new password<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirm} onChange={event => setConfirm(event.target.value)} /></label>
    {message && <p role="status">{message}</p>}
    <button className="button" disabled={busy}>{busy ? 'Saving…' : 'Save new password'}</button>
  </form></details>;
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
    [account, setAccount] = useState(false),
    [stats, setStats] = useState(false),
    [notice, setNotice] = useState("");
  const [signingOut,setSigningOut]=useState(false);
  const [selectedExport,setSelectedExport]=useState<string[]>([]);
  useEffect(()=>{
    const id=requestAnimationFrame(()=>{ const heading=document.querySelector<HTMLElement>('h1, main, [role="main"]'); if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});} });
    return ()=>cancelAnimationFrame(id);
  },[path]);
  const match = path.match(/^\/book\/([^/]+)(\/notebook)?/),
    book = match
      ? library.books.find((b) => b.id === decodeURIComponent(match[1]))
      : undefined;
  async function jump(b: Book, at: Anchor) {
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
  const openAccount = () => (user ? setAccount(true) : onAccount());
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
  async function backup() {
    const password = window.prompt("Choose a backup password (at least 12 characters). Keep it safe: it cannot be recovered.");
    if (!password) return;
    if (password.length < 12) { setNotice("Use a backup password with at least 12 characters."); return; }
    type Sink={write:(part:BlobPart)=>Promise<void>;close:()=>Promise<void>;abort:()=>Promise<void>};
    let sink:Sink|undefined;
    try {
      const picker=(window as unknown as {showSaveFilePicker?: (options:unknown)=>Promise<{createWritable:()=>Promise<Sink>}>}).showSaveFilePicker;
      if(picker)sink=await (await picker.call(window,{suggestedName:'readwind-backup.readwind'})).createWritable();
      for (const b of library.books.filter(b=>!selectedExport.length || selectedExport.includes(b.id))) {
        const ids = bookAssets(b);
        for (const id of ids)
          if (!(await library.loadBlob(id)))
            throw new Error(
              "Connect to download every attached file before making a full backup.",
            );
      }
    } catch (e) {
      await sink?.abort().catch(()=>{});
      setNotice((e as Error).message);
      return;
    }
    const books = (await library.db.books.toArray()).filter(b=>!selectedExport.length || selectedExport.includes(b.id));
    const selected=new Set(books.map(b=>b.id));
    const used=new Set(books.flatMap(bookAssets));
    try {
      const annotations=(await library.db.annotations.toArray()).filter(a=>selected.has(a.bookId));
      const progress=(await library.db.progress.toArray()).filter(p=>selected.has(p.bookId));
      const files=[];
      for(const id of used)files.push({id,load:async()=>{const blob=await library.loadBlob(id);if(!blob)throw new Error('An attachment is unavailable. Connect before exporting.');return blob;}});
      const archive=await createArchive({format:'folio-backup-1',books,annotations,progress,settings:library.settings},files,password,sink);
      if(sink){await sink.close();setNotice('Encrypted backup saved.');return;}
      const url=URL.createObjectURL(archive);
      const a = document.createElement("a");
      a.href = url;
      a.download = "readwind-backup.readwind";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { await sink?.abort().catch(()=>{});setNotice((e as Error).message); }
  }
  async function restore(f: File) {
    try {
      const {data,files} = await readBackup(f, () => window.prompt("Enter the backup password."));
      if(!window.confirm(`Restore ${data.books.length} books? Matching IDs replace local copies; other books stay. Settings and reading statistics are merged. The entire restore is applied together.`))return;
      await library.restoreArchive(data,files);
      setNotice("Backup restored. Your library is syncing.");
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  return (
    <>
      <span className="sr-only" role="status" aria-live="polite">{book ? book.title : path.includes("notebook") ? "Notebook" : path.includes("collections") ? "Collections" : "Library"}</span>
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
      {stats && <ReadingStats library={library} onClose={() => setStats(false)} />}
      {account && (
        <Modal title="Your reading room" onClose={() => setAccount(false)}>
          <div className="account-profile">
            <Icon name="user" size={28} />
            <div>
              <h3>{user?.name}</h3>
              <p>{user?.email}</p>
            </div>
          </div>
          <div className="account-status" role="status" aria-live="polite">
            <Icon name="cloud" />
            <span>{library.status}</span>
          </div>
          <button
            className="account-stats"
            onClick={() => {
              setAccount(false);
              setStats(true);
            }}
          >
            <Flame size={18} lit={false} />
            <span>
              <strong>Reading stats</strong>
              <small>Speed, time, words and your streak</small>
            </span>
            <Icon name="next" size={18} />
          </button>
          {library.failedChanges.map(change=><div key={change.id} role="alert"><p>{change.entity} · {change.error}</p>{!!change.alternate && <><details><summary>Review local and other-device versions</summary><pre style={{maxHeight:240,overflow:'auto',whiteSpace:'pre-wrap'}}>{JSON.stringify({local:change.value,otherDevice:change.alternate},null,2)}</pre></details><button className="button" onClick={()=>void library.resolveFailedChange(change.id,true)}>Keep this device’s version</button><button className="button" onClick={()=>void library.resolveFailedChange(change.id,false)}>Use other device’s version</button></>}</div>)}
          <AppearanceControl />
          <label><input type="checkbox" defaultChecked={typeof window!=='undefined' && localStorage.getItem('readwind-offline-enabled')==='true'} onChange={event=>{
            localStorage.setItem('readwind-offline-enabled',String(event.target.checked));
            if(event.target.checked && user)localStorage.setItem('folio-offline-user',JSON.stringify({...user,offlineUntil:Date.now()+30*86400000}));
            else localStorage.removeItem('folio-offline-user');
          }}/> Keep offline access between launches for 30 days</label>
          <p className="muted">Anyone using this browser can open downloaded books when offline. Enable this only on a personal device. Cloud sync always requires a valid sign-in.</p>
          {auth && <AccountPassword auth={auth} />}
          <AccountStorage library={library} onDeleted={()=>{location.href=new URL('/',location.origin).href;}}/>
          <p className="muted">
            Your books and notes belong to this account. Sign out removes downloaded
            books and notes from this device. Sync first to save your latest changes.
          </p>
          <div className="conflict-options">
            <button
              className="button primary"
              onClick={() => void library.sync(true)}
            >
              Sync now
            </button>
            <details><summary>Select books for backup (all by default)</summary>{library.books.map(b=><label key={b.id} style={{display:'block'}}><input type="checkbox" checked={selectedExport.includes(b.id)} onChange={event=>setSelectedExport(ids=>event.target.checked?[...ids,b.id]:ids.filter(id=>id!==b.id))}/>{b.title}</label>)}</details>
            <button className="button" onClick={() => void backup()}>
              Download encrypted backup
            </button>
            <label className="button backup-restore">
              Restore a backup
              <input
                type="file"
                accept="application/json,.json,.readwind"
                hidden
                onChange={(e) => {
                  if (e.target.files?.[0]) void restore(e.target.files[0]);
                }}
              />
            </label>
            <button
              className="button"
              disabled={signingOut}
              onClick={async () => {
                setSigningOut(true);
                try {
                  if(!await library.prepareSignOut())throw new Error('Sign-out paused: changes or recovery still need to sync. Resolve conflicts or download a backup, then retry. Your local work is preserved.');
                  await onSignOut();
                } catch(error){setNotice((error as Error).message);library.resumeEditing();}
                finally{setSigningOut(false);}
              }}
            >
              Sign out
            </button>
          </div>
        </Modal>
      )}
    </>
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
    if (hasImports && window.confirm("Copy this device's guest books and notes into your account?")) {
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
      if(!cleared)window.alert('Signed out. Newer changes from another tab were retained privately on this device. Sign back into the same account to sync them.');
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
