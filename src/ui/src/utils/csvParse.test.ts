import { describe, it, expect } from "vitest";

import { countCsvLines, parseCsv } from "./csvParse";

describe("parseCsv", () => {
  it("splits a simple comma-separated row", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("respects quoted fields containing commas", () => {
    expect(parseCsv('name,note\n"Smith, J.",hi\n')).toEqual([
      ["name", "note"],
      ["Smith, J.", "hi"],
    ]);
  });

  it("handles escaped quotes inside a quoted field", () => {
    expect(parseCsv('a,b\n"he said ""hi""",x\n')).toEqual([
      ["a", "b"],
      ['he said "hi"', "x"],
    ]);
  });

  it("preserves newlines inside quoted fields", () => {
    expect(parseCsv('a,b\n"line1\nline2",x\n')).toEqual([
      ["a", "b"],
      ["line1\nline2", "x"],
    ]);
  });

  it("flushes a trailing row without a newline", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("respects maxRows", () => {
    const text = "a\n1\n2\n3\n4\n5\n";
    const got = parseCsv(text, 3);
    expect(got).toEqual([["a"], ["1"], ["2"]]);
  });

  it("ignores blank lines from trailing newlines", () => {
    expect(parseCsv("a\n1\n\n")).toEqual([["a"], ["1"]]);
  });
});

describe("countCsvLines", () => {
  it("counts lines without a trailing newline", () => {
    expect(countCsvLines("a\n1\n2")).toBe(3);
  });

  it("counts lines with a trailing newline", () => {
    expect(countCsvLines("a\n1\n2\n")).toBe(3);
  });

  it("treats CRLF as one line break", () => {
    expect(countCsvLines("a\r\n1\r\n2\r\n")).toBe(3);
  });

  it("returns 0 for empty input", () => {
    expect(countCsvLines("")).toBe(0);
  });
});
