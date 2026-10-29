"use client";
import { useEffect } from "react";
import { animate } from "motion/react";

// Press, hover, ripple and tilt feedback for every control in the app.
// Handlers are delegated from the document so each button doesn't need wiring.
const PRESS = "button, a.wordmark, .shelf-item, .cover-button, .drop-tile";
const LIFT = ".button, .shelf-item, .drop-tile, .cover-button";
const RIPPLE = ".button, .icon-button";
const TILT = ".shelf-item, .cover-button";

const snappy = { type: "spring", stiffness: 620, damping: 26 } as const;
const bouncy = { type: "spring", stiffness: 380, damping: 14, mass: 0.7 } as const;

const closest = (target: EventTarget | null, selector: string) =>
  target instanceof Element ? (target.closest<HTMLElement>(selector) ?? null) : null;
const enabled = (el: HTMLElement | null): el is HTMLElement =>
  !!el &&
  !(el as HTMLButtonElement).disabled &&
  el.getAttribute("aria-disabled") !== "true";

export function Interactions() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

    const rest = (el: HTMLElement) =>
      el.matches(LIFT) && fine && el.matches(":hover")
        ? { scale: 1.03, y: -3 }
        : { scale: 1, y: 0 };

    const ripple = (el: HTMLElement, e: PointerEvent) => {
      const box = el.getBoundingClientRect();
      const size = Math.max(box.width, box.height) * 2.2;
      const drop = document.createElement("span");
      drop.className = "fx-ripple";
      drop.setAttribute("aria-hidden", "true");
      Object.assign(drop.style, {
        width: `${size}px`,
        height: `${size}px`,
        left: `${e.clientX - box.left - size / 2}px`,
        top: `${e.clientY - box.top - size / 2}px`,
      });
      el.appendChild(drop);
      animate(
        drop,
        { scale: [0.1, 1], opacity: [0.28, 0] },
        { duration: 0.65, ease: [0.22, 1, 0.36, 1] },
      ).then(() => drop.remove());
    };

    const down = (e: PointerEvent) => {
      const pressed = closest(e.target, PRESS);
      if (enabled(pressed)) animate(pressed, { scale: 0.95, y: 0 }, snappy);
      const dropEl = closest(e.target, RIPPLE);
      if (enabled(dropEl)) ripple(dropEl, e);
    };
    const up = (e: PointerEvent) => {
      const pressed = closest(e.target, PRESS);
      if (enabled(pressed)) animate(pressed, rest(pressed), bouncy);
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const el = closest(e.target, LIFT);
      if (!enabled(el) || el.contains(e.relatedTarget as Node | null)) return;
      animate(el, { scale: 1.03, y: -3 }, bouncy);
    };
    const out = (e: PointerEvent) => {
      const el = closest(e.target, PRESS);
      if (!el || el.contains(e.relatedTarget as Node | null)) return;
      animate(el, { scale: 1, y: 0 }, { type: "spring", stiffness: 420, damping: 28 });
      const cover = el.querySelector<HTMLElement>(".shelf-cover");
      if (cover && el.matches(TILT))
        animate(cover, { rotateX: 0, rotateY: 0 }, { duration: 0.45, ease: "easeOut" });
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const el = closest(e.target, TILT);
      const cover = el?.querySelector<HTMLElement>(".shelf-cover");
      if (!el || !cover) return;
      const box = cover.getBoundingClientRect();
      const x = (e.clientX - box.left) / box.width;
      const y = (e.clientY - box.top) / box.height;
      cover.style.setProperty("--sheen-x", `${x * 100}%`);
      cover.style.setProperty("--sheen-y", `${y * 100}%`);
      animate(
        cover,
        { rotateY: (x - 0.5) * 14, rotateX: (0.5 - y) * 14 },
        { duration: 0.18, ease: "easeOut" },
      );
    };

    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
    document.addEventListener("pointerover", over, true);
    document.addEventListener("pointerout", out, true);
    document.addEventListener("pointermove", move, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("pointerout", out, true);
      document.removeEventListener("pointermove", move, true);
    };
  }, []);
  return null;
}
