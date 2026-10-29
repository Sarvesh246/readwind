"use client";
import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Icon } from "./Icon";

const subscribe = () => () => {};
/** True after hydration, false during the server render — without a state update in an effect. */
const useMounted = () =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

const options = [
  { value: "system", label: "System", icon: "system" },
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
] as const;

/** Three-way appearance control for the profile area. */
export function AppearanceControl() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const current = mounted ? (theme ?? "system") : "system";
  return (
    <section className="appearance" aria-labelledby="appearance-title">
      <div className="appearance-heading">
        <strong id="appearance-title">Appearance</strong>
        <small>Follows your system unless you choose.</small>
      </div>
      <div
        className="appearance-options"
        role="group"
        aria-labelledby="appearance-title"
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={current === o.value}
            className="appearance-option"
            onClick={() => setTheme(o.value)}
          >
            <Icon name={o.icon} size={17} />
            <span>{o.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** One-tap light/dark switch for the library header. */
export function ThemeToggleButton() {
  const { setTheme } = useTheme();
  return (
    <button
      type="button"
      className="icon-button theme-toggle"
      aria-label="Switch between light and dark appearance"
      title="Switch between light and dark appearance"
      onClick={() => {
        const dark = document.documentElement.dataset.theme === "dark";
        setTheme(dark ? "light" : "dark");
      }}
    >
      <span className="theme-icon theme-icon-light">
        <Icon name="moon" size={18} />
      </span>
      <span className="theme-icon theme-icon-dark">
        <Icon name="sun" size={18} />
      </span>
    </button>
  );
}
