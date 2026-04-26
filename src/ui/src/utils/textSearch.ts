/**
 * Text-search primitives for the in-chat Cmd/Ctrl+F search bar.
 *
 * Kept dependency-free so they can run anywhere in the React tree (and in
 * tests) without pulling in store / DOM context. Both helpers are O(n) over
 * the input text.
 */

export interface MatchRange {
  /** Inclusive start index into the original text. */
  start: number;
  /** Exclusive end index into the original text. */
  end: number;
}

// Module-level monotonic counter handed out by `nextSearchMatchId()`. Both
// the React-render-time `HighlightedPlainText` and the post-render DOM
// walker in `HighlightedMessageMarkdown` stamp their `<mark>` elements
// with these ids so the ChatSearchBar can group adjacent / split marks
// that belong to the same logical match. Globally-unique avoids id
// collisions between multiple highlight wrappers rendering at the same
// time. Wrap-around is fine — Number.MAX_SAFE_INTEGER would take an
// unrealistic number of renders to reach.
let nextMatchIdCounter = 0;
export function nextSearchMatchId(): string {
  return String(nextMatchIdCounter++);
}

// Escape every regex metacharacter so the user's query is treated as a
// literal substring even when it contains characters like "." or "(".
function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find every case-insensitive substring occurrence of `needle` in `haystack`.
 * Empty needles return no matches (avoids an infinite loop and matches the
 * "no query → no highlight" UX).
 *
 * Uses a `gi` regex on the original string (rather than lower-casing both
 * sides and walking with indexOf) so the returned `{start, end}` indices
 * line up with the original `haystack`. Some Unicode case folds change
 * string length — e.g. "İ" lowercases to "i" + a combining dot — and the
 * old index-by-lowercased-string approach silently misaligned `<mark>`
 * insertion for those characters. The regex match's `index` and `[0]`
 * length are always in source-string coordinates.
 *
 * Matches advance by the matched length so overlapping hits aren't
 * double-counted (e.g. searching "aa" in "aaaa" returns 2 matches at 0 and 2).
 */
export function findAllRanges(haystack: string, needle: string): MatchRange[] {
  if (!needle) return [];
  if (!haystack) return [];
  const re = new RegExp(escapeRegExp(needle), "gi");
  const out: MatchRange[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(haystack)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    out.push({ start, end });
    // If the match was zero-width (shouldn't happen with our escapes, but
    // be defensive), advance manually so we don't loop forever.
    if (end === start) re.lastIndex = start + 1;
  }
  return out;
}

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "match"; text: string; rangeIndex: number };

/**
 * Split `text` into alternating non-match / match segments using the supplied
 * ranges. `rangeIndex` on each match segment carries the position of the
 * range in the input array so callers can map a segment back to a global
 * match index for active-match highlighting.
 *
 * Ranges must be non-overlapping and sorted by `start`. (`findAllRanges`
 * already produces them in that shape.)
 */
export function splitByRanges(text: string, ranges: MatchRange[]): Segment[] {
  if (ranges.length === 0) {
    return text ? [{ kind: "text", text }] : [];
  }
  const out: Segment[] = [];
  let cursor = 0;
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    if (r.start > cursor) {
      out.push({ kind: "text", text: text.slice(cursor, r.start) });
    }
    out.push({
      kind: "match",
      text: text.slice(r.start, r.end),
      rangeIndex: i,
    });
    cursor = r.end;
  }
  if (cursor < text.length) {
    out.push({ kind: "text", text: text.slice(cursor) });
  }
  return out;
}
