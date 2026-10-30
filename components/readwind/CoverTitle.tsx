"use client";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * A cover title that shrinks until it fits the space left by the author,
 * subtitle and resume pill. The CSS font size is treated as the maximum so
 * each cover size keeps its own scale.
 */
export function CoverTitle({
  text,
  className,
  maxSize = 24,
  minSize = 7,
  style,
}: {
  text: string;
  className?: string;
  maxSize?: number;
  minSize?: number;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(() =>
    initialSize(text, maxSize, minSize),
  );

  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;

    const fit = () => {
      const parent = el.parentElement;
      if (!parent) return;
      // Read the stylesheet size (not our inline size) as the upper bound.
      el.style.fontSize = "";
      el.style.overflowWrap = "normal";
      const cssMax = Number.parseFloat(getComputedStyle(el).fontSize) || maxSize;
      const max = Math.max(minSize, Math.min(96, cssMax));
      const available = availableHeight(el, parent);
      if (!available || !el.clientWidth) {
        el.style.fontSize = `${size}px`;
        return;
      }
      el.style.maxHeight = `${available}px`;

      let lo = minSize;
      let hi = max;
      let best = minSize;
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        el.style.fontSize = `${mid}px`;
        const fits =
          el.scrollHeight <= available + 1 &&
          el.scrollWidth <= el.clientWidth + 1;
        if (fits) {
          best = mid;
          lo = mid;
        } else {
          hi = mid;
        }
      }
      el.style.fontSize = `${best}px`;
      // A single unbreakable word (a URL, an invented name) may still not fit
      // at the minimum size. Only then allow arbitrary breaks.
      if (best <= minSize + 0.01) el.style.overflowWrap = "anywhere";
      setSize((current) =>
        Math.abs(current - best) > 0.5 ? best : current,
      );
    };

    fit();
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    observer.observe(el.parentElement!);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [text, maxSize, minSize]);

  return (
    <div
      ref={ref}
      className={`cover-title-fit${className ? ` ${className}` : ""}`}
      style={{ ...style, fontSize: size }}
      title={text}
    >
      {text}
    </div>
  );
}

function initialSize(text: string, max: number, min: number) {
  const chars = Math.max(1, text.trim().length);
  // A stable server/client guess; the layout effect refines it before paint.
  const guess = max * Math.sqrt(16 / Math.max(16, chars));
  return Math.round(Math.max(min, Math.min(max, guess)));
}

/** Space left in the cover after padding and the other flow children. */
function availableHeight(el: HTMLElement, parent: HTMLElement) {
  const parentStyle = getComputedStyle(parent);
  const padTop = Number.parseFloat(parentStyle.paddingTop) || 0;
  const padBottom = Number.parseFloat(parentStyle.paddingBottom) || 0;
  const gap = Number.parseFloat(parentStyle.rowGap) || 0;
  let used = padTop + padBottom + (Number.parseFloat(getComputedStyle(el).marginTop) || 0);
  let siblings = 0;
  for (const child of Array.from(parent.children)) {
    if (!(child instanceof HTMLElement) || child === el) continue;
    if (
      child.classList.contains("cover-spacer") ||
      child.classList.contains("bookmark-ribbon") ||
      getComputedStyle(child).position === "absolute"
    )
      continue;
    used += child.offsetHeight;
    siblings++;
  }
  used += gap * siblings;
  return Math.max(0, parent.clientHeight - used);
}
