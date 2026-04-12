import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/**
 * Sticky-scroll hook: auto-scrolls to bottom when user is at the bottom of a
 * scrollable container, but stops when the user scrolls up.
 *
 * Tracks position via scroll events + ResizeObserver (catches content loads,
 * streaming growth, and window focus without external coordination).
 *
 * Returns `isAtBottom` for rendering a "jump to bottom" indicator, plus
 * `scrollToBottom` and `handleContentChanged` helpers.
 */
export function useStickyScroll(
  containerRef: RefObject<HTMLElement | null>,
  threshold = 60,
) {
  const isAtBottomRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const programmaticScrollRef = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const checkPosition = () => {
      const atBottom =
        el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
      if (atBottom !== isAtBottomRef.current) {
        isAtBottomRef.current = atBottom;
        setIsAtBottom(atBottom);
      }
    };

    const onScroll = () => {
      if (programmaticScrollRef.current) {
        programmaticScrollRef.current = false;
        return;
      }
      checkPosition();
    };

    // ResizeObserver catches content height changes (message load, streaming
    // growth, content-visibility recalc) that don't fire scroll events.
    const resizeObserver = new ResizeObserver(() => checkPosition());
    resizeObserver.observe(el);

    // Re-check on window focus (content may arrive while app is backgrounded).
    const onFocus = () => checkPosition();

    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("focus", onFocus);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("focus", onFocus);
      resizeObserver.disconnect();
    };
  }, [containerRef, threshold]);

  /** Programmatically scroll to bottom and re-enable auto-follow. */
  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    programmaticScrollRef.current = true;
    el.scrollTop = el.scrollHeight;
    isAtBottomRef.current = true;
    setIsAtBottom(true);
    // Second pass after layout settles (content-visibility recalc).
    requestAnimationFrame(() => {
      if (!containerRef.current) return;
      programmaticScrollRef.current = true;
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    });
  }, [containerRef]);

  /**
   * Call when new content is added. Auto-scrolls only if the user is already
   * at the bottom. The check is inside the RAF callback so a user scroll that
   * fires between scheduling and execution correctly cancels the auto-scroll.
   */
  const handleContentChanged = useCallback(() => {
    requestAnimationFrame(() => {
      if (!isAtBottomRef.current) return;
      const el = containerRef.current;
      if (el) {
        const prev = el.scrollTop;
        el.scrollTop = el.scrollHeight;
        if (el.scrollTop !== prev) {
          programmaticScrollRef.current = true;
        }
      }
    });
  }, [containerRef]);

  return { isAtBottom, scrollToBottom, handleContentChanged } as const;
}
