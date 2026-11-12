"use client";
import { lazy, Suspense, useMemo, useState } from "react";
import type { Library } from "@/lib/readwind/useLibrary";
import type { AuthClient } from "@/lib/readwind/useLibrary";
import { bookAssets } from "@/lib/readwind/catalog";
import { dailyTotals, dayKey, qualifyingDays, statsOf, streakOf } from "@/lib/readwind/reading-log";
import { Icon } from "./Icon";
import { Flame } from "./Flame";
import { AppearanceControl, ThemeToggleButton } from "./Theme";

const AccountStorage = lazy(() => import("./AccountStorage").then((m) => ({ default: m.AccountStorage })));

type User = { id: string; name: string; email: string };

const initialsOf = (name: string | undefined, email: string | undefined) => {
  const words = (name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (email || "?")[0].toUpperCase();
};

const shortTime = (seconds: number) => {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return seconds > 0 ? "<1m" : "0m";
  if (minutes < 60) return `${minutes}m`;
  return minutes % 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${Math.floor(minutes / 60)}h`;
};

function PasswordForm({ auth }: { auth: AuthClient }) {
  const [current, setCurrent] = useState(""),
    [next, setNext] = useState(""),
    [confirm, setConfirm] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <details className="profile-disclosure">
      <summary>
        <span className="row-text">
          <strong>Password</strong>
          <small>Change the password you sign in with</small>
        </span>
      </summary>
      <form
        className="auth-form profile-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setMessage("");
          if (next !== confirm) {
            setMessage("Those new passwords don’t match.");
            return;
          }
          setBusy(true);
          try {
            const result = await auth.changePassword({ currentPassword: current, newPassword: next });
            if (result.error) throw new Error(result.error.message || "We couldn’t change your password. Please try again.");
            setCurrent("");
            setNext("");
            setConfirm("");
            setMessage("Your password has been updated.");
          } catch (error) {
            setMessage((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Current password
          <input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <label>
          New password
          <input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={next} onChange={(e) => setNext(e.target.value)} />
          <small className="field-hint">At least 12 characters.</small>
        </label>
        <label>
          Confirm new password
          <input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        {message && <p role="status" className="panel-message">{message}</p>}
        <button className="button primary" disabled={busy}>{busy ? "Saving…" : "Update password"}</button>
      </form>
    </details>
  );
}

export function Profile({
  library: l,
  user,
  auth,
  navigate,
  onStats,
  onSignIn,
  onSignOut,
  onNotice,
}: {
  library: Library;
  user: User | null;
  auth: AuthClient | null;
  navigate: (path: string) => void;
  onStats: () => void;
  onSignIn: () => void;
  onSignOut: () => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [signingOut, setSigningOut] = useState(false),
    [selectedExport, setSelectedExport] = useState<string[]>([]);
  const today = dayKey();
  const streak = useMemo(() => streakOf(qualifyingDays(dailyTotals(l.readingLog, today)).keys(), today), [l.readingLog, today]);
  const stats = useMemo(() => statsOf(l.readingLog, today), [l.readingLog, today]);
  const guest = !user;

  async function backup() {
    const password = window.prompt("Choose a password to protect this backup (at least 12 characters). Keep it somewhere safe — it can’t be recovered.");
    if (!password) return;
    if (password.length < 12) {
      onNotice("Please use a backup password with at least 12 characters.");
      return;
    }
    type Sink = { write: (part: BlobPart) => Promise<void>; close: () => Promise<void>; abort: () => Promise<void> };
    let sink: Sink | undefined;
    try {
      const picker = (window as unknown as { showSaveFilePicker?: (options: unknown) => Promise<{ createWritable: () => Promise<Sink> }> }).showSaveFilePicker;
      if (picker) sink = await (await picker.call(window, { suggestedName: "readwind-backup.readwind" })).createWritable();
      for (const b of l.books.filter((b) => !selectedExport.length || selectedExport.includes(b.id))) {
        for (const id of bookAssets(b))
          if (!(await l.loadBlob(id))) throw new Error("Connect to the internet so every book file can be downloaded before making a full backup.");
      }
    } catch (e) {
      await sink?.abort().catch(() => {});
      onNotice((e as Error).message);
      return;
    }
    const books = (await l.db.books.toArray()).filter((b) => !selectedExport.length || selectedExport.includes(b.id));
    const selected = new Set(books.map((b) => b.id));
    const used = new Set(books.flatMap(bookAssets));
    try {
      const annotations = (await l.db.annotations.toArray()).filter((a) => selected.has(a.bookId));
      const progress = (await l.db.progress.toArray()).filter((p) => selected.has(p.bookId));
      const files = [];
      for (const id of used)
        files.push({
          id,
          load: async () => {
            const blob = await l.loadBlob(id);
            if (!blob) throw new Error("A book file isn’t available right now. Connect to the internet and try again.");
            return blob;
          },
        });
      const { createArchive } = await import("@/lib/readwind/backup");
      const archive = await createArchive({ format: "folio-backup-1", books, annotations, progress, settings: l.settings }, files, password, sink);
      if (sink) {
        await sink.close();
        onNotice("Your encrypted backup was saved.");
        return;
      }
      const url = URL.createObjectURL(archive);
      const a = document.createElement("a");
      a.href = url;
      a.download = "readwind-backup.readwind";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      await sink?.abort().catch(() => {});
      onNotice((e as Error).message);
    }
  }

  async function restore(f: File) {
    try {
      const { readBackup } = await import("@/lib/readwind/backup");
      const { data, files } = await readBackup(f, () => window.prompt("Enter the password for this backup."));
      if (!window.confirm(`Restore ${data.books.length} ${data.books.length === 1 ? "book" : "books"} from this backup? Books that are already here will be replaced with the backup’s copy. Everything else on your shelf stays as it is.`)) return;
      await l.restoreArchive(data, files);
      onNotice(guest ? "Backup restored." : "Backup restored. Your library is syncing.");
    } catch (e) {
      onNotice((e as Error).message);
    }
  }

  const passwordForm = auth ? <PasswordForm auth={auth} /> : null;
  const signOutRow = (
    <div className="profile-row">
      <span className="row-text">
        <strong>Sign out</strong>
        <small>Books and notes downloaded to this device are removed. Your account keeps everything.</small>
      </span>
      <button
        className="button"
        disabled={signingOut}
        onClick={async () => {
          setSigningOut(true);
          try {
            if (!(await l.prepareSignOut()))
              throw new Error("Some changes haven’t finished syncing yet. Resolve them or download a backup, then try again. Nothing has been lost.");
            await onSignOut();
          } catch (error) {
            onNotice((error as Error).message);
            l.resumeEditing();
          } finally {
            setSigningOut(false);
          }
        }}
      >
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );

  return (
    <main className="app-shell profile-screen">
      <header className="document-header">
        <button className="icon-button" aria-label="Back to library" onClick={() => navigate("/")}>
          <Icon name="back" />
        </button>
        <h1>Profile</h1>
        <ThemeToggleButton />
      </header>
      <div className="profile-layout">
        <aside className="profile-aside">
          <section className="profile-card profile-identity" aria-label="Your account">
            <span className="profile-avatar" aria-hidden="true">
              {guest ? <Icon name="user" size={30} /> : initialsOf(user?.name, user?.email)}
            </span>
            {guest ? (
              <>
                <h2>Reading as a guest</h2>
                <p>Your books are saved on this device only. Sign in to keep them on every device you read on.</p>
                <button className="button primary" onClick={onSignIn}>Sign in or create an account</button>
              </>
            ) : (
              <>
                <h2>{user?.name || "Your account"}</h2>
                <p className="profile-email">{user?.email}</p>
                <div className="profile-sync" role="status" aria-live="polite">
                  <Icon name="cloud" size={16} />
                  <span>{l.status}</span>
                </div>
                <button className="button primary" onClick={() => void l.sync(true)}>Sync now</button>
              </>
            )}
          </section>
          <section className="profile-card profile-glance" aria-label="Reading at a glance">
            <div>
              <span className="glance-value">
                <Flame size={18} lit={streak.readToday || streak.current > 0} />
                <strong>{streak.current}</strong>
              </span>
              <span>day streak</span>
            </div>
            <div>
              <strong>{shortTime(stats.seconds)}</strong>
              <span>time reading</span>
            </div>
            <div>
              <strong>{l.books.length}</strong>
              <span>{l.books.length === 1 ? "book" : "books"}</span>
            </div>
          </section>
        </aside>

        <div className="profile-main">
          {l.failedChanges.length > 0 && (
            <section className="profile-section" aria-labelledby="profile-attention">
              <h2 id="profile-attention">Needs your attention</h2>
              <div className="profile-card profile-attention">
                {l.failedChanges.map((change) => (
                  <div key={change.id} role="alert" className="profile-row profile-stack">
                    <span className="row-text">
                      <strong>A change to your {change.entity} didn’t sync</strong>
                      <small>{change.error}</small>
                    </span>
                    {!!change.alternate && (
                      <>
                        <details className="profile-inline-details">
                          <summary>Compare the two versions</summary>
                          <pre>{JSON.stringify({ thisDevice: change.value, otherDevice: change.alternate }, null, 2)}</pre>
                        </details>
                        <div className="profile-button-row">
                          <button className="button small" onClick={() => void l.resolveFailedChange(change.id, true)}>Keep this device’s version</button>
                          <button className="button small" onClick={() => void l.resolveFailedChange(change.id, false)}>Use the other device’s version</button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="profile-section" aria-labelledby="profile-reading">
            <h2 id="profile-reading">Reading</h2>
            <div className="profile-card">
              <button className="profile-link" onClick={onStats}>
                <Flame size={20} lit={false} />
                <span className="row-text">
                  <strong>Reading stats</strong>
                  <small>Speed, time, words and your streak</small>
                </span>
                <Icon name="next" size={18} />
              </button>
            </div>
          </section>

          <section className="profile-section" aria-labelledby="profile-preferences">
            <h2 id="profile-preferences">Preferences</h2>
            <div className="profile-card">
              <div className="profile-block">
                <AppearanceControl />
              </div>
              {!guest && (
                <label className="profile-row profile-switch">
                  <span className="row-text">
                    <strong>Read offline for up to 30 days</strong>
                    <small>Open your downloaded books without a connection. Anyone using this browser could open them, so only turn this on for a personal device.</small>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    className="switch"
                    defaultChecked={typeof window !== "undefined" && localStorage.getItem("readwind-offline-enabled") === "true"}
                    onChange={(event) => {
                      localStorage.setItem("readwind-offline-enabled", String(event.target.checked));
                      if (event.target.checked && user) localStorage.setItem("folio-offline-user", JSON.stringify({ ...user, offlineUntil: Date.now() + 30 * 86400000 }));
                      else localStorage.removeItem("folio-offline-user");
                    }}
                  />
                </label>
              )}
            </div>
          </section>

          <section className="profile-section" aria-labelledby="profile-backup">
            <h2 id="profile-backup">Backup</h2>
            <p className="profile-lede">Keep a private, password-protected copy of your books and notes, or bring one back.</p>
            <div className="profile-card">
              <div className="profile-row profile-stack">
                <span className="row-text">
                  <strong>Download a backup</strong>
                  <small>{selectedExport.length ? `${selectedExport.length} of ${l.books.length} books selected` : "Includes your whole library by default."}</small>
                </span>
                <details className="profile-inline-details">
                  <summary>Choose which books to include</summary>
                  <div className="profile-button-row">
                    <button type="button" className="button small" onClick={() => setSelectedExport(l.books.map((b) => b.id))}>Select all</button>
                    <button type="button" className="button small" onClick={() => setSelectedExport([])}>Include everything</button>
                  </div>
                  <div className="backup-list">
                    {l.books.map((b) => (
                      <label key={b.id} className="check-row">
                        <input
                          type="checkbox"
                          checked={selectedExport.includes(b.id)}
                          onChange={(event) => setSelectedExport((ids) => (event.target.checked ? [...ids, b.id] : ids.filter((id) => id !== b.id)))}
                        />
                        <span>{b.title}</span>
                      </label>
                    ))}
                  </div>
                </details>
                <button className="button" onClick={() => void backup()}>Download backup</button>
              </div>
              <div className="profile-row">
                <span className="row-text">
                  <strong>Restore from a backup</strong>
                  <small>Choose a backup file you saved earlier.</small>
                </span>
                <label className="button backup-restore">
                  Choose file
                  <input
                    type="file"
                    accept="application/json,.json,.readwind"
                    hidden
                    onChange={(e) => {
                      if (e.target.files?.[0]) void restore(e.target.files[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            </div>
          </section>

          {guest ? (
            <p className="profile-footnote">Sign in to see storage, devices and account options here.</p>
          ) : (
            <Suspense fallback={null}>
              <AccountStorage
                library={l}
                passwordForm={passwordForm}
                signOutRow={signOutRow}
                onDeleted={() => {
                  location.href = new URL("/", location.origin).href;
                }}
              />
            </Suspense>
          )}
        </div>
      </div>
    </main>
  );
}
