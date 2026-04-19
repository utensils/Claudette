/** Format a token count for compact display in chat metadata.
 *  Values under 1000 render as raw integers ("999"); values 1000+ render
 *  as a k-compact value with one decimal ("1.2k", "10.0k"). Truncation
 *  is always toward zero so we never over-report usage. */
export function formatTokens(n: number): string {
  if (n < 1000) {
    return `${n}`;
  }
  const tenths = Math.trunc(n / 100) / 10;
  return `${tenths.toFixed(1)}k`;
}
