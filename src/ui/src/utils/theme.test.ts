import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

afterAll(() => {
  vi.unstubAllGlobals();
});

/**
 * vitest runs without a DOM, so we shim `document.documentElement.style`
 * with a Map-backed fake that supports getPropertyValue / setProperty.
 */
const styleMap = new Map<string, string>();
const fakeStyle = {
  getPropertyValue: (name: string) => styleMap.get(name) ?? "",
  setProperty: (name: string, value: string) => { styleMap.set(name, value); },
  removeProperty: (name: string) => { styleMap.delete(name); },
  get fontSize() { return styleMap.get("font-size") ?? ""; },
  set fontSize(v: string) { styleMap.set("font-size", v); },
  get cssText() { return ""; },
  set cssText(_v: string) { styleMap.clear(); },
};

// Minimal body shim: just tracks attributes via a Map.
const bodyAttrs = new Map<string, string>();
const fakeBody = {
  setAttribute: (name: string, value: string) => { bodyAttrs.set(name, value); },
  getAttribute: (name: string) => bodyAttrs.get(name) ?? null,
  removeAttribute: (name: string) => { bodyAttrs.delete(name); },
};

// Minimal head / link tracking. registry is keyed by element id; elements
// removed via remove() are evicted so subsequent getElementById returns null.
type FakeLink = {
  id: string;
  rel: string;
  href: string;
  remove: () => void;
};
const elementsById = new Map<string, FakeLink>();
const fakeHead = {
  appendChild: (el: FakeLink) => {
    if (el.id) elementsById.set(el.id, el);
  },
};
function makeFakeLink(): FakeLink {
  const link: FakeLink = {
    id: "",
    rel: "",
    href: "",
    remove: () => {
      if (link.id) elementsById.delete(link.id);
    },
  };
  return link;
}

vi.stubGlobal("document", {
  documentElement: { style: fakeStyle },
  body: fakeBody,
  getElementById: (id: string) => elementsById.get(id) ?? null,
  createElement: (_tag: string) => makeFakeLink(),
  head: fakeHead,
});

// Mock the tauri service import that pulls in other runtime dependencies.
vi.mock("../services/tauri", () => ({
  listUserThemes: async () => [],
}));

// Import AFTER the global stub so the module sees our fake document.
const {
  applyUserFonts,
  clearUserFont,
  DEFAULT_SANS_STACK,
  DEFAULT_MONO_STACK,
  applyTheme,
  findTheme,
} = await import("./theme");
const { isStructuredTheme } = await import("../types/theme");
type ThemeDefinition = import("../types/theme").ThemeDefinition;
type StructuredTheme = import("../types/theme").StructuredTheme;
type LegacyTheme = import("../types/theme").LegacyTheme;

describe("applyUserFonts", () => {
  beforeEach(() => {
    styleMap.clear();
  });

  it("sets zoom level based on font size (base 13px)", () => {
    applyUserFonts("", "", 16);
    const zoom = parseFloat(styleMap.get("zoom") ?? "0");
    expect(zoom).toBeCloseTo(16 / 13, 2);
  });

  it("zoom is 1.0 at default size 13px", () => {
    applyUserFonts("", "", 13);
    const zoom = parseFloat(styleMap.get("zoom") ?? "0");
    expect(zoom).toBeCloseTo(1.0, 2);
  });

  it("sets --font-sans when non-empty", () => {
    applyUserFonts("Roboto", "", 13);
    const val = styleMap.get("--font-sans") ?? "";
    expect(val).toContain("Roboto");
    expect(val).toContain("Instrument Sans");
  });

  it("does not touch --font-sans when empty (preserves theme value)", () => {
    styleMap.set("--font-sans", "ThemeFont");
    applyUserFonts("", "", 13);
    expect(styleMap.get("--font-sans")).toBe("ThemeFont");
  });

  it("sets --font-mono when non-empty", () => {
    applyUserFonts("", "Fira Code", 13);
    const val = styleMap.get("--font-mono") ?? "";
    expect(val).toContain("Fira Code");
    expect(val).toContain("JetBrains Mono");
  });

  it("does not touch --font-mono when empty (preserves theme value)", () => {
    styleMap.set("--font-mono", "MonoTheme");
    applyUserFonts("", "", 13);
    expect(styleMap.get("--font-mono")).toBe("MonoTheme");
  });

  it("applies both fonts simultaneously", () => {
    applyUserFonts("Avenir Next", "SF Mono", 15);
    expect(styleMap.get("--font-sans")).toContain("Avenir Next");
    expect(styleMap.get("--font-mono")).toContain("SF Mono");
    expect(parseFloat(styleMap.get("zoom") ?? "0")).toBeCloseTo(15 / 13, 2);
  });
});

describe("font stack constants", () => {
  it("DEFAULT_SANS_STACK contains Instrument Sans", () => {
    expect(DEFAULT_SANS_STACK).toContain("Instrument Sans");
  });

  it("DEFAULT_MONO_STACK contains JetBrains Mono", () => {
    expect(DEFAULT_MONO_STACK).toContain("JetBrains Mono");
  });
});

describe("clearUserFont", () => {
  beforeEach(() => {
    styleMap.clear();
  });

  it("removes --font-sans inline override", () => {
    styleMap.set("--font-sans", '"SF Pro", fallback');
    clearUserFont("font-sans");
    expect(styleMap.has("--font-sans")).toBe(false);
  });

  it("removes --font-mono inline override", () => {
    styleMap.set("--font-mono", '"Fira Code", fallback');
    clearUserFont("font-mono");
    expect(styleMap.has("--font-mono")).toBe(false);
  });

  it("is a no-op when property does not exist", () => {
    clearUserFont("font-sans");
    expect(styleMap.has("--font-sans")).toBe(false);
  });

  it("does not affect other properties", () => {
    styleMap.set("--font-sans", "SomeFont");
    styleMap.set("--font-mono", "SomeMono");
    clearUserFont("font-sans");
    expect(styleMap.has("--font-sans")).toBe(false);
    expect(styleMap.get("--font-mono")).toBe("SomeMono");
  });
});

describe("applyUserFonts + clearUserFont round-trip", () => {
  beforeEach(() => {
    styleMap.clear();
  });

  it("set then clear restores to empty state", () => {
    applyUserFonts("Roboto", "Fira Code", 16);
    expect(styleMap.get("--font-sans")).toContain("Roboto");
    expect(styleMap.get("--font-mono")).toContain("Fira Code");

    clearUserFont("font-sans");
    clearUserFont("font-mono");
    expect(styleMap.has("--font-sans")).toBe(false);
    expect(styleMap.has("--font-mono")).toBe(false);
    // zoom persists
    expect(styleMap.has("zoom")).toBe(true);
  });
});

describe("applyTheme (structured shape)", () => {
  beforeEach(() => {
    styleMap.clear();
  });

  const theme: StructuredTheme = {
    manifest: { id: "atlas", name: "Atlas", scheme: "dark" },
    tokens: {
      color: {
        "accent-primary": "#abcdef",
        "app-bg": "#111111",
        "panel-bg": "#222222",
      },
      typography: {
        "font-size-base": "15px",
      },
      radius: {
        "radius-md": "6px",
      },
      layout: {
        "chat-max-width": "720px",
      },
    },
  };

  it("sets CSS custom properties for every known token in the theme", () => {
    applyTheme(theme);
    expect(styleMap.get("--accent-primary")).toBe("#abcdef");
    expect(styleMap.get("--app-bg")).toBe("#111111");
    expect(styleMap.get("--panel-bg")).toBe("#222222");
    expect(styleMap.get("--font-size-base")).toBe("15px");
    expect(styleMap.get("--radius-md")).toBe("6px");
    // Regression: new layout tokens must be in THEMEABLE_TOKENS so a
    // theme can tune chat-canvas width / density.
    expect(styleMap.get("--chat-max-width")).toBe("720px");
  });

  it("sets color-scheme property from the manifest", () => {
    applyTheme(theme);
    expect(styleMap.get("color-scheme")).toBe("dark");
  });

  it("clears previously-set tokens when re-applying a theme missing them", () => {
    applyTheme(theme);
    expect(styleMap.get("--app-bg")).toBe("#111111");

    const leaner: StructuredTheme = {
      manifest: { id: "lean", name: "Lean", scheme: "dark" },
      tokens: { color: { "accent-primary": "#00ff00" } },
    };
    applyTheme(leaner);
    // --accent-primary overwritten to the new value
    expect(styleMap.get("--accent-primary")).toBe("#00ff00");
    // --app-bg should have been cleared, not left at the old theme's value
    expect(styleMap.has("--app-bg")).toBe(false);
  });

  it("ignores tokens not in the themeable allowlist without throwing", () => {
    const withUnknown: StructuredTheme = {
      manifest: { id: "rogue", name: "Rogue", scheme: "dark" },
      tokens: {
        color: { "accent-primary": "#123456" },
        // A misspelled / unknown token should be silently dropped.
        unknown: { "not-a-real-token": "oops" },
      },
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    applyTheme(withUnknown);
    expect(styleMap.has("--not-a-real-token")).toBe(false);
    expect(styleMap.get("--accent-primary")).toBe("#123456");
    warnSpy.mockRestore();
  });
});

describe("applyTheme (legacy flat shape)", () => {
  beforeEach(() => {
    styleMap.clear();
  });

  it("applies tokens from a flat `colors` map", () => {
    const legacy: LegacyTheme = {
      id: "classic",
      name: "Classic",
      colors: {
        "color-scheme": "light",
        "accent-primary": "#dd9900",
        "app-bg": "#fefefe",
      },
    };
    applyTheme(legacy);
    expect(styleMap.get("--accent-primary")).toBe("#dd9900");
    expect(styleMap.get("--app-bg")).toBe("#fefefe");
    expect(styleMap.get("color-scheme")).toBe("light");
  });
});

describe("applyTheme body[data-theme]", () => {
  beforeEach(() => {
    styleMap.clear();
    bodyAttrs.clear();
    elementsById.clear();
  });

  it("sets body[data-theme] to the structured theme id", () => {
    const theme: StructuredTheme = {
      manifest: { id: "atlas", name: "Atlas", scheme: "dark" },
      tokens: { color: { "accent-primary": "#abcdef" } },
    };
    applyTheme(theme);
    expect(bodyAttrs.get("data-theme")).toBe("atlas");
  });

  it("sets body[data-theme] to the legacy theme id", () => {
    const legacy: LegacyTheme = {
      id: "legacy-id",
      name: "Legacy",
      colors: { "accent-primary": "#f00" },
    };
    applyTheme(legacy);
    expect(bodyAttrs.get("data-theme")).toBe("legacy-id");
  });

  it("updates body[data-theme] when switching themes", () => {
    const a: StructuredTheme = {
      manifest: { id: "first", name: "First" },
      tokens: { color: { "accent-primary": "#111" } },
    };
    const b: StructuredTheme = {
      manifest: { id: "second", name: "Second" },
      tokens: { color: { "accent-primary": "#222" } },
    };
    applyTheme(a);
    expect(bodyAttrs.get("data-theme")).toBe("first");
    applyTheme(b);
    expect(bodyAttrs.get("data-theme")).toBe("second");
  });
});

describe("applyTheme per-theme stylesheet link", () => {
  beforeEach(() => {
    styleMap.clear();
    bodyAttrs.clear();
    elementsById.clear();
  });

  it("injects <link id=theme-stylesheet> when the theme declares a stylesheet", () => {
    const theme: StructuredTheme = {
      manifest: {
        id: "sheeted",
        name: "Sheeted",
        stylesheet: "/themes/sheeted.css",
      },
      tokens: { color: { "accent-primary": "#abc" } },
    };
    applyTheme(theme);
    const link = elementsById.get("theme-stylesheet");
    expect(link).toBeDefined();
    expect(link?.rel).toBe("stylesheet");
    expect(link?.href).toBe("/themes/sheeted.css");
  });

  it("removes the link when switching to a theme without a stylesheet", () => {
    const sheeted: StructuredTheme = {
      manifest: { id: "a", name: "A", stylesheet: "/themes/a.css" },
      tokens: { color: { "accent-primary": "#abc" } },
    };
    const bare: StructuredTheme = {
      manifest: { id: "b", name: "B" },
      tokens: { color: { "accent-primary": "#abc" } },
    };
    applyTheme(sheeted);
    expect(elementsById.has("theme-stylesheet")).toBe(true);
    applyTheme(bare);
    expect(elementsById.has("theme-stylesheet")).toBe(false);
  });

  it("updates the link href when switching between stylesheet-bearing themes", () => {
    const first: StructuredTheme = {
      manifest: { id: "one", name: "One", stylesheet: "/themes/one.css" },
      tokens: { color: { "accent-primary": "#000" } },
    };
    const second: StructuredTheme = {
      manifest: { id: "two", name: "Two", stylesheet: "/themes/two.css" },
      tokens: { color: { "accent-primary": "#fff" } },
    };
    applyTheme(first);
    expect(elementsById.get("theme-stylesheet")?.href).toBe("/themes/one.css");
    applyTheme(second);
    expect(elementsById.get("theme-stylesheet")?.href).toBe("/themes/two.css");
  });

  it("omits the link entirely when no theme in a sequence has a stylesheet", () => {
    const a: StructuredTheme = {
      manifest: { id: "plain-a", name: "A" },
      tokens: { color: { "accent-primary": "#111" } },
    };
    const b: StructuredTheme = {
      manifest: { id: "plain-b", name: "B" },
      tokens: { color: { "accent-primary": "#222" } },
    };
    applyTheme(a);
    applyTheme(b);
    expect(elementsById.has("theme-stylesheet")).toBe(false);
  });

  it("honors the stylesheet field on legacy flat themes", () => {
    const legacy: LegacyTheme = {
      id: "legacy-sheet",
      name: "Legacy Sheet",
      stylesheet: "/themes/legacy.css",
      colors: { "accent-primary": "#123" },
    };
    applyTheme(legacy);
    expect(elementsById.get("theme-stylesheet")?.href).toBe("/themes/legacy.css");
  });

  it("does not crash when the theme JSON includes an unknown stylesheet-shaped field", () => {
    // Simulate a user theme that accidentally includes extra fields —
    // applyTheme should be robust to anything normalizeTheme surfaces.
    const quirky = {
      manifest: { id: "quirky", name: "Quirky" },
      tokens: { color: { "accent-primary": "#abc" } },
      // Unknown top-level field — ignored by normalizeTheme. We're just
      // verifying applyTheme stays happy with extra keys on the input.
      stylesheet: "/ignored.css",
    } as unknown as ThemeDefinition;
    expect(() => applyTheme(quirky)).not.toThrow();
    // Since normalizeTheme reads stylesheet from manifest (not top level)
    // for structured themes, no link should be injected here.
    expect(elementsById.has("theme-stylesheet")).toBe(false);
  });
});

describe("findTheme", () => {
  const structured: ThemeDefinition = {
    manifest: { id: "aurora", name: "Aurora" },
    tokens: { color: { "accent-primary": "#0f0" } },
  };
  const legacy: ThemeDefinition = {
    id: "legacy",
    name: "Legacy",
    colors: { "accent-primary": "#f00" },
  };

  it("returns the requested theme by id regardless of shape", () => {
    const themes = [structured, legacy];
    expect(isStructuredTheme(findTheme(themes, "aurora"))).toBe(true);
    expect(isStructuredTheme(findTheme(themes, "legacy"))).toBe(false);
  });

  it("falls back to the default theme when requested id is missing", () => {
    // DEFAULT_THEME_ID is "default" — include a matching theme.
    const defaultTheme: ThemeDefinition = {
      manifest: { id: "default", name: "Default" },
      tokens: { color: { "accent-primary": "#fff" } },
    };
    const themes = [defaultTheme, legacy];
    const found = findTheme(themes, "does-not-exist");
    expect(isStructuredTheme(found)).toBe(true);
  });

  it("falls back to the first theme when neither requested nor default is present", () => {
    const themes = [legacy, structured];
    const found = findTheme(themes, "missing");
    expect(isStructuredTheme(found)).toBe(false);
    // findTheme should have returned `legacy` (first in list).
    const meta = (found as LegacyTheme);
    expect(meta.id).toBe("legacy");
  });

  it("throws when no themes are available", () => {
    expect(() => findTheme([], "anything")).toThrow(/No themes/i);
  });
});
