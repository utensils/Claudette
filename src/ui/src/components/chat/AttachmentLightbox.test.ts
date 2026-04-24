import { describe, it, expect } from "vitest";
import {
  isBackdropDismiss,
  nextFocusTarget,
} from "./AttachmentLightbox";

// The lightbox component is thin DOM wiring around two pure decisions:
// should a mousedown close the overlay, and where should focus go on Tab.
// Both are unit-tested here without a jsdom harness — following the same
// convention as AttachmentContextMenu.test.ts.

describe("isBackdropDismiss", () => {
  it("returns true when the target is the backdrop element itself", () => {
    const backdrop = {} as HTMLElement;
    expect(isBackdropDismiss(backdrop, backdrop)).toBe(true);
  });

  it("returns false for clicks on descendants of the backdrop", () => {
    const backdrop = {} as HTMLElement;
    const inner = {} as HTMLElement;
    expect(isBackdropDismiss(inner, backdrop)).toBe(false);
  });

  it("returns false when backdrop ref is null", () => {
    expect(isBackdropDismiss({} as HTMLElement, null)).toBe(false);
  });

  it("returns false when target is null", () => {
    expect(isBackdropDismiss(null, {} as HTMLElement)).toBe(false);
  });
});

describe("nextFocusTarget", () => {
  const close = { id: "close" } as unknown as HTMLElement;
  const wrap = { id: "wrap" } as unknown as HTMLElement;

  it("Tab from close moves focus to the image wrapper", () => {
    expect(nextFocusTarget(close, false, close, wrap)).toBe(wrap);
  });

  it("Tab from wrap cycles back to the close button", () => {
    expect(nextFocusTarget(wrap, false, close, wrap)).toBe(close);
  });

  it("Shift+Tab from close moves focus to the image wrapper", () => {
    expect(nextFocusTarget(close, true, close, wrap)).toBe(wrap);
  });

  it("Shift+Tab from wrap moves focus back to the close button", () => {
    expect(nextFocusTarget(wrap, true, close, wrap)).toBe(close);
  });

  it("Tab from an element outside the trap pulls focus back to close", () => {
    expect(nextFocusTarget(null, false, close, wrap)).toBe(close);
    const stray = {} as HTMLElement;
    expect(nextFocusTarget(stray, false, close, wrap)).toBe(close);
  });

  it("Shift+Tab from an element outside the trap also pulls focus to close", () => {
    expect(nextFocusTarget(null, true, close, wrap)).toBe(close);
  });
});
