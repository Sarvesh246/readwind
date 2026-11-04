"use client";
import { useEffect } from "react";
import { ThemeProvider, useTheme } from "next-themes";

/** Keeps the browser chrome in step with the resolved theme, including manual overrides. */
function ThemeColorSync() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    const color = resolvedTheme === "dark" ? "#1a1511" : "#efe8da";
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((meta) => meta.setAttribute("content", color));
  }, [resolvedTheme]);
  return null;
}

/**
 * Focus rings are for keyboard users. After a mouse or touch interaction the browser can still keep
 * (or script-move) focus on a control and draw a ring that only disappears on the next click, so
 * the last input device is exposed as data-input and the stylesheet hides rings for pointer use.
 */
function InputModality() {
  useEffect(() => {
    const root = document.documentElement;
    const set = (mode: string) => { if (root.dataset.input !== mode) root.dataset.input = mode; };
    const key = (e: KeyboardEvent) => { if (e.key === "Tab" || e.key.startsWith("Arrow")) set("keyboard"); };
    const pointer = () => set("pointer");
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointerdown", pointer, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("pointerdown", pointer, true);
    };
  }, []);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="readwind-theme"
    >
      <ThemeColorSync />
      <InputModality />
      {children}
    </ThemeProvider>
  );
}
