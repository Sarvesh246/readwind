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
      {children}
    </ThemeProvider>
  );
}
