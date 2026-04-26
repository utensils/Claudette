import { Fragment, memo, useMemo } from "react";
import {
  findAllRanges,
  nextSearchMatchId,
  splitByRanges,
} from "../../utils/textSearch";

/**
 * Renders plain text with `<mark class="cc-search-match">` segments around
 * every case-insensitive substring match of `query`. When `query` is empty,
 * the text renders as-is — no DOM nodes are inserted, so the search-off
 * path has zero overhead.
 *
 * The shared `cc-search-match` class is what `ChatSearchBar` queries to
 * count and target the active match. Don't rename without updating the bar.
 */
export const HighlightedPlainText = memo(function HighlightedPlainText({
  text,
  query,
}: {
  text: string;
  query: string;
}) {
  const result = useMemo(() => {
    if (!query) return null;
    const ranges = findAllRanges(text, query);
    if (ranges.length === 0) return null;
    // Pre-allocate one id per match so every <mark> we render shares the
    // same data-match-id with the markdown wrapper's tagging scheme. The
    // ChatSearchBar groups marks by id, so an id per match here keeps the
    // counter aligned with what the user perceives as "one match" — even
    // when a match would later split (it can't here, but symmetry helps).
    const ids = ranges.map(() => nextSearchMatchId());
    return { segments: splitByRanges(text, ranges), ids };
  }, [text, query]);

  if (!result) {
    return <>{text}</>;
  }
  return (
    <>
      {result.segments.map((seg, i) => (
        <Fragment key={i}>
          {seg.kind === "match" ? (
            <mark
              className="cc-search-match"
              data-match-id={result.ids[seg.rangeIndex]}
            >
              {seg.text}
            </mark>
          ) : (
            seg.text
          )}
        </Fragment>
      ))}
    </>
  );
});
