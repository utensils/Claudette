import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { EXTERNAL_SCHEMES, trimTrailingCodeNewline } from "./markdown";

describe("EXTERNAL_SCHEMES", () => {
  it("matches http URLs", () => {
    expect(EXTERNAL_SCHEMES.test("http://example.com")).toBe(true);
  });

  it("matches https URLs", () => {
    expect(EXTERNAL_SCHEMES.test("https://github.com/utensils/claudette")).toBe(true);
  });

  it("matches mailto URLs", () => {
    expect(EXTERNAL_SCHEMES.test("mailto:user@example.com")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(EXTERNAL_SCHEMES.test("HTTPS://EXAMPLE.COM")).toBe(true);
    expect(EXTERNAL_SCHEMES.test("HTTP://EXAMPLE.COM")).toBe(true);
    expect(EXTERNAL_SCHEMES.test("Mailto:user@example.com")).toBe(true);
  });

  it("rejects file:// URLs", () => {
    expect(EXTERNAL_SCHEMES.test("file:///etc/passwd")).toBe(false);
  });

  it("rejects javascript: URLs", () => {
    expect(EXTERNAL_SCHEMES.test("javascript:alert(1)")).toBe(false);
  });

  it("rejects data: URLs", () => {
    expect(EXTERNAL_SCHEMES.test("data:text/html,<h1>hi</h1>")).toBe(false);
  });

  it("rejects fragment links", () => {
    expect(EXTERNAL_SCHEMES.test("#section")).toBe(false);
  });

  it("rejects relative paths", () => {
    expect(EXTERNAL_SCHEMES.test("/some/path")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(EXTERNAL_SCHEMES.test("")).toBe(false);
  });
});

describe("trimTrailingCodeNewline", () => {
  it("strips a trailing newline from a single string child", () => {
    expect(trimTrailingCodeNewline("const x = 1;\n")).toEqual(["const x = 1;"]);
  });

  it("strips multiple trailing newlines", () => {
    expect(trimTrailingCodeNewline("const x = 1;\n\n\n")).toEqual(["const x = 1;"]);
  });

  it("preserves internal newlines", () => {
    expect(trimTrailingCodeNewline("a\nb\nc\n")).toEqual(["a\nb\nc"]);
  });

  it("drops a trailing whitespace-only text node", () => {
    const span = createElement("span", { key: "k" }, "code");
    const result = trimTrailingCodeNewline([span, "\n"]) as React.ReactNode[];
    expect(result).toHaveLength(1);
    expect((result[0] as React.ReactElement).type).toBe("span");
  });

  it("trims trailing newline from the last text node after a span", () => {
    const span = createElement("span", { key: "k" }, "const");
    const result = trimTrailingCodeNewline([span, " x = 1;\n"]) as React.ReactNode[];
    expect(result).toHaveLength(2);
    expect((result[0] as React.ReactElement).type).toBe("span");
    expect(result[1]).toBe(" x = 1;");
  });

  it("is a no-op when there is no trailing newline", () => {
    const span = createElement("span", { key: "k" }, "const");
    const result = trimTrailingCodeNewline([span, " x = 1;"]) as React.ReactNode[];
    expect(result).toHaveLength(2);
    expect(result[1]).toBe(" x = 1;");
  });

  it("returns the original input when children are empty", () => {
    expect(trimTrailingCodeNewline([])).toEqual([]);
    expect(trimTrailingCodeNewline(null)).toBe(null);
  });

  it("does not modify the last child if it is a non-string element", () => {
    const span = createElement("span", { key: "k" }, "code");
    const result = trimTrailingCodeNewline([span]) as React.ReactNode[];
    expect(result).toHaveLength(1);
    expect((result[0] as React.ReactElement).type).toBe("span");
  });
});
