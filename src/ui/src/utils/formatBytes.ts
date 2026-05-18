/**
 * Format a byte count for human display using binary units (KiB / MiB / GiB).
 *
 * Decisions:
 *   - Bytes < 1024 → integer "<n> B".
 *   - KiB / MiB / GiB → up to 1 decimal place; trailing ".0" trimmed.
 *   - Null / undefined / NaN / negative → "0 B" (defensive — input may
 *     come from a Rust Option<u64> serialized as null).
 *
 * Replaces the inline copies in PluginsSettings.tsx, SoundPackBrowser.tsx,
 * AttachmentCardShell.tsx, DiffViewer.tsx, and FileViewer.tsx. Those use
 * KB/MB/GB labels (technically wrong for base 1024) — migrate them in a
 * follow-up so the whole UI agrees on units.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  const units = ["KiB", "MiB", "GiB", "TiB"] as const;
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  const rounded = Math.round(value * 10) / 10;
  const formatted = Number.isInteger(rounded)
    ? rounded.toFixed(0)
    : rounded.toFixed(1);
  return `${formatted} ${units[unitIndex]}`;
}
