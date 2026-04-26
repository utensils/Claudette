import { describe, it, expect } from "vitest";
import { findAllRanges, nextSearchMatchId, splitByRanges } from "./textSearch";

describe("findAllRanges", () => {
  it("returns no matches for an empty needle", () => {
    expect(findAllRanges("hello world", "")).toEqual([]);
  });

  it("returns no matches for an empty haystack", () => {
    expect(findAllRanges("", "x")).toEqual([]);
  });

  it("finds a single occurrence", () => {
    expect(findAllRanges("hello world", "world")).toEqual([
      { start: 6, end: 11 },
    ]);
  });

  it("finds multiple occurrences", () => {
    expect(findAllRanges("foo bar foo bar foo", "foo")).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 11 },
      { start: 16, end: 19 },
    ]);
  });

  it("is case-insensitive", () => {
    expect(findAllRanges("Hello HELLO hello", "HeLLo")).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 11 },
      { start: 12, end: 17 },
    ]);
  });

  it("does not double-count overlapping matches", () => {
    // 'aa' inside 'aaaa' produces hits at 0 and 2, not 0/1/2.
    expect(findAllRanges("aaaa", "aa")).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it("handles needle longer than haystack", () => {
    expect(findAllRanges("hi", "hello")).toEqual([]);
  });

  it("handles unicode characters", () => {
    expect(findAllRanges("café CAFÉ café", "café")).toEqual([
      { start: 0, end: 4 },
      // 'CAFÉ' lowercases to 'café' so the middle hit lands too.
      { start: 5, end: 9 },
      { start: 10, end: 14 },
    ]);
  });

  it("treats regex metacharacters in the needle literally", () => {
    // Regex metacharacters in the user's query must not change matching —
    // searching "a.c" should not match "abc" (the dot is literal, not "any
    // character"). These would all break a non-escaped RegExp constructor.
    expect(findAllRanges("abc a.c", "a.c")).toEqual([{ start: 4, end: 7 }]);
    expect(findAllRanges("(open)", "(")).toEqual([{ start: 0, end: 1 }]);
    expect(findAllRanges("a+b a*b", "a*b")).toEqual([{ start: 4, end: 7 }]);
  });

  it("returns ranges in original-string coordinates after a length-changing case fold", () => {
    // The old `toLowerCase()` + `indexOf` approach silently misaligned
    // when a character in the haystack changed length on lowercase — e.g.
    // "İ" (1 code unit) lowercases to "i" + COMBINING DOT ABOVE (2 units).
    // Matches *after* the length-changing character then sliced the wrong
    // span out of the original string. The regex-on-original approach
    // returns indices that always line up with the source.
    const haystack = "İab";
    expect(haystack.toLowerCase()).toHaveLength(haystack.length + 1);
    const ranges = findAllRanges(haystack, "ab");
    expect(ranges).toHaveLength(1);
    expect(haystack.slice(ranges[0].start, ranges[0].end)).toBe("ab");
  });
});

describe("splitByRanges", () => {
  it("returns empty array for empty input", () => {
    expect(splitByRanges("", [])).toEqual([]);
  });

  it("returns a single text segment when there are no ranges", () => {
    expect(splitByRanges("hello world", [])).toEqual([
      { kind: "text", text: "hello world" },
    ]);
  });

  it("splits into text + match + text", () => {
    expect(
      splitByRanges("hello world", [{ start: 6, end: 11 }]),
    ).toEqual([
      { kind: "text", text: "hello " },
      { kind: "match", text: "world", rangeIndex: 0 },
    ]);
  });

  it("emits a leading match without an empty text segment", () => {
    expect(splitByRanges("hello", [{ start: 0, end: 5 }])).toEqual([
      { kind: "match", text: "hello", rangeIndex: 0 },
    ]);
  });

  it("interleaves multiple matches", () => {
    expect(
      splitByRanges("foo bar foo bar foo", [
        { start: 0, end: 3 },
        { start: 8, end: 11 },
        { start: 16, end: 19 },
      ]),
    ).toEqual([
      { kind: "match", text: "foo", rangeIndex: 0 },
      { kind: "text", text: " bar " },
      { kind: "match", text: "foo", rangeIndex: 1 },
      { kind: "text", text: " bar " },
      { kind: "match", text: "foo", rangeIndex: 2 },
    ]);
  });

  it("preserves rangeIndex even when ranges are passed in order", () => {
    const segments = splitByRanges("ab cd ef", [
      { start: 0, end: 2 },
      { start: 6, end: 8 },
    ]);
    const matches = segments.filter((s) => s.kind === "match");
    expect(matches).toEqual([
      { kind: "match", text: "ab", rangeIndex: 0 },
      { kind: "match", text: "ef", rangeIndex: 1 },
    ]);
  });
});

describe("nextSearchMatchId", () => {
  it("returns a fresh string id on every call", () => {
    const a = nextSearchMatchId();
    const b = nextSearchMatchId();
    const c = nextSearchMatchId();
    expect(typeof a).toBe("string");
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);
  });
});

describe("end-to-end: splitByRanges over findAllRanges output", () => {
  // The two helpers compose in the production highlight pipeline, so
  // verify a couple of common chat-search shapes end-to-end.
  it("splits prose containing multiple highlighted matches", () => {
    const text = "the quick brown fox jumps over the lazy dog";
    const ranges = findAllRanges(text, "the");
    const segments = splitByRanges(text, ranges);
    const stitched = segments.map((s) => s.text).join("");
    expect(stitched).toBe(text);
    expect(segments.filter((s) => s.kind === "match").map((s) => s.text)).toEqual([
      "the",
      "the",
    ]);
  });

  it("splits a query that touches the start of the string", () => {
    const text = "Hello world";
    const ranges = findAllRanges(text, "hello");
    const segments = splitByRanges(text, ranges);
    expect(segments).toEqual([
      { kind: "match", text: "Hello", rangeIndex: 0 },
      { kind: "text", text: " world" },
    ]);
  });

  it("splits a query that touches the end of the string", () => {
    const text = "Hello world";
    const ranges = findAllRanges(text, "world");
    const segments = splitByRanges(text, ranges);
    expect(segments).toEqual([
      { kind: "text", text: "Hello " },
      { kind: "match", text: "world", rangeIndex: 0 },
    ]);
  });
});
