"use client";
import { useEffect, useState } from "react";
import type { Book, Anchor } from "@/lib/readwind/types";
import { useLibrary } from "@/lib/readwind/useLibrary";
import type { AuthClient } from "@/lib/readwind/useLibrary";
import { Library } from "./Library";
import { BookReader } from "./BookReader";
import { Notebook } from "./Notebook";
import { Import } from "./Import";
import { Modal } from "./Modal";
import { Icon } from "./Icon";
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
  useEffect(() => {
    if (new URLSearchParams(location.search).has("token")) setMode("reset");
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
        setMode("reset-code");
        setPassword("");
        setInfo("If this account exists, a reset code is on its way.");
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
        const token = new URLSearchParams(location.search).get("token") || "";
        const r = await auth.resetPassword({ newPassword: password, token });
        if (r.error) throw new Error(r.error.message);
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
      const result =
        mode === "signup"
          ? await auth.signUp.email({ name, email, password })
          : await auth.signIn.email({ email, password });
      if (result.error) {
        if (result.error.code === "EMAIL_NOT_VERIFIED") {
          await auth.emailOtp.sendVerificationOtp({
            email,
            type: "email-verification",
          });
          setMode("verify");
          setInfo("Enter the verification code sent to your email.");
          return;
        }
        throw new Error(result.error.message || "Could not sign in.");
      }
      const session = await auth.getSession();
      if (session.data?.user) {
        onSuccess(session.data.user as User);
      } else {
        await auth.emailOtp.sendVerificationOtp({
          email,
          type: "email-verification",
        });
        setMode("verify");
        setInfo("Check your email for a verification code.");
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
              minLength={8}
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
                forgot: "Send reset code",
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
}: {
  user: User | null;
  auth: AuthClient | null;
  navigate: (path: string) => void;
  path: string;
  onAccount: () => void;
  onSignOut: () => void;
}) {
  const library = useLibrary(user?.id || "preview", auth),
    [file, setFile] = useState<File | null>(null),
    [account, setAccount] = useState(false),
    [notice, setNotice] = useState("");
  const match = path.match(/^\/book\/([^/]+)(\/notebook)?/),
    book = match
      ? library.books.find((b) => b.id === decodeURIComponent(match[1]))
      : undefined;
  async function jump(b: Book, at: Anchor) {
    await library.saveProgress(b.id, at, 0);
    navigate(`/book/${b.id}`);
  }
  function onFile(f: File) {
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") {
      setNotice("Choose a PDF file to import.");
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
    try {
      for (const b of library.books) {
        const ids = [
          b.sourcePdfBlobId,
          b.cover.blobId,
          ...b.sections.flatMap((s) =>
            s.blocks.flatMap((b) => (b.type === "figure" ? [b.blobId] : [])),
          ),
        ].filter(Boolean) as string[];
        for (const id of ids)
          if (!(await library.loadBlob(id)))
            throw new Error(
              "Connect to download every attached file before making a full backup.",
            );
      }
    } catch (e) {
      setNotice((e as Error).message);
      return;
    }
    const books = await library.db.books.toArray(),
      annotations = await library.db.annotations.toArray(),
      progress = await library.db.progress.toArray(),
      blobs = await library.db.blobs.toArray();
    const encoded = await Promise.all(
      blobs.map(async (b) => ({
        id: b.id,
        type: b.blob.type,
        data: await new Promise<string>((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as string);
          r.readAsDataURL(b.blob);
        }),
      })),
    );
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify({
            format: "folio-backup-1",
            books,
            annotations,
            progress,
            settings: library.settings,
            blobs: encoded,
          }),
        ],
        { type: "application/json" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "readwind-backup.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function restore(f: File) {
    try {
      const data = JSON.parse(await f.text());
      if (data.format !== "folio-backup-1" || !Array.isArray(data.books))
        throw new Error("This is not a Readwind backup.");
      const files = await Promise.all(
        (data.blobs || []).map(async (b: { id: string; data: string }) => ({
          id: b.id,
          blob: await (await fetch(b.data)).blob(),
        })),
      );
      for (const b of data.books) await library.addBook(b, files);
      for (const a of data.annotations || []) await library.saveAnnotation(a);
      for (const p of data.progress || [])
        await library.saveProgress(p.bookId, p.at, p.wordsRead);
      if (data.settings) await library.saveSettings(data.settings);
      setNotice("Backup restored. Your library is syncing.");
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  return (
    <>
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
      ) : path === "/import" ? (
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
          name={user?.name}
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
      {account && (
        <Modal title="Your reading room" onClose={() => setAccount(false)}>
          <div className="account-profile">
            <Icon name="user" size={28} />
            <div>
              <h3>{user?.name}</h3>
              <p>{user?.email}</p>
            </div>
          </div>
          <div className="account-status">
            <Icon name="cloud" />
            <span>{library.status}</span>
          </div>
          <p className="muted">
            Your books and notes belong to this account. Downloaded books stay
            available on this device while offline.
          </p>
          <div className="conflict-options">
            <button
              className="button primary"
              onClick={() => void library.sync()}
            >
              Sync now
            </button>
            <button className="button" onClick={() => void backup()}>
              Download a full backup
            </button>
            <label className="button backup-restore">
              Restore a backup
              <input
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  if (e.target.files?.[0]) void restore(e.target.files[0]);
                }}
              />
            </label>
            <button
              className="button"
              onClick={() => {
                setAccount(false);
                onSignOut();
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
    [loaded, setLoaded] = useState(false);
  const navigate = (url: string) => {
    history.pushState(null, "", url);
    setPath(url.split("?")[0]);
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    let alive = true;
    setPath(location.pathname);
    if (new URLSearchParams(location.search).has("reset")) setShowAuth(true);
    fetch("/api/config")
      .then((r) => r.json() as Promise<{ authUrl: string | null }>)
      .then(async (config) => {
        if (!config.authUrl) return;
        const { createReadwindAuth } = await import("@/lib/readwind/auth");
        const client = createReadwindAuth(config.authUrl);
        if (!alive) return;
        setAuth(() => client);
        const session = await client.getSession();
        if (alive && session.data?.user) {
          const u = session.data.user as User;
          setUser(u);
          localStorage.setItem("folio-offline-user", JSON.stringify(u));
        }
      })
      .catch(() => {
        if (!navigator.onLine) {
          try {
            const u = JSON.parse(
              localStorage.getItem("folio-offline-user") || "null",
            );
            if (alive) setUser(u);
          } catch {}
        }
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    const pop = () => setPath(location.pathname);
    window.addEventListener("popstate", pop);
    return () => {
      alive = false;
      window.removeEventListener("popstate", pop);
    };
  }, []);
  async function signedIn(u: User) {
    try {
      const { migratePreview } = await import("@/lib/readwind/migrate-preview");
      await migratePreview(u.id);
    } catch {
      console.warn("Preview imports remain saved locally.");
    }
    setUser(u);
    localStorage.setItem("folio-offline-user", JSON.stringify(u));
    setShowAuth(false);
    navigate("/");
  }
  async function signOut() {
    await auth?.signOut();
    localStorage.removeItem("folio-offline-user");
    setUser(null);
    navigate("/");
  }
  if (!loaded)
    return (
      <div className="opening-screen">
        <div className="wordmark">Readwind</div>
        <p>A little room to read.</p>
      </div>
    );
  return (
    <>
      <Workspace
        key={user?.id || "preview"}
        user={user}
        auth={auth}
        navigate={navigate}
        path={path}
        onAccount={() => setShowAuth(true)}
        onSignOut={() => void signOut()}
      />
      {showAuth && (
        <AuthForm
          auth={auth}
          onSuccess={(u) => void signedIn(u)}
          onClose={() => setShowAuth(false)}
        />
      )}
    </>
  );
}
