import type { CompletedTurn } from "../../stores/useAppStore";

export type Band = "normal" | "warn" | "near-full" | "critical";

export interface MeterState {
  totalTokens: number;
  capacity: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  ratio: number;
  fillPercent: number;
  percentRounded: number;
  band: Band;
}

/** Thresholds per the Phase 2 spec: 60 / 80 / 90 % */
export function bandForRatio(ratio: number): Band {
  if (ratio >= 0.9) return "critical";
  if (ratio >= 0.8) return "near-full";
  if (ratio >= 0.6) return "warn";
  return "normal";
}

/**
 * Compute everything the ContextMeter component needs to render, or null
 * if the meter should be hidden. Returning null (rather than throwing)
 * covers: no turn yet, pre-migration turn missing token metadata, and
 * stale model ids with zero/undefined capacity.
 */
export function computeMeterState(
  turn: CompletedTurn | undefined,
  capacity: number | undefined,
): MeterState | null {
  if (!turn) return null;
  if (typeof turn.inputTokens !== "number") return null;
  if (typeof turn.outputTokens !== "number") return null;
  if (typeof capacity !== "number" || capacity <= 0) return null;

  const input = turn.inputTokens;
  const output = turn.outputTokens;
  const cacheRead = turn.cacheReadTokens ?? 0;
  const cacheCreation = turn.cacheCreationTokens ?? 0;
  const totalTokens = input + cacheRead + cacheCreation + output;
  const ratio = totalTokens / capacity;
  const fillPercent = Math.min(ratio, 1) * 100;
  const percentRounded = Math.round(ratio * 100);
  const band = bandForRatio(ratio);

  return {
    totalTokens,
    capacity,
    input,
    output,
    cacheRead,
    cacheCreation,
    ratio,
    fillPercent,
    percentRounded,
    band,
  };
}

interface TooltipInput {
  totalTokens: number;
  capacity: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

/**
 * Build the multi-line tooltip string shown on hover. Uses toLocaleString()
 * for thousand separators so numbers read cleanly (e.g. "62,450").
 */
export function buildMeterTooltip(state: TooltipInput): string {
  const percentRounded = Math.round((state.totalTokens / state.capacity) * 100);
  return [
    `Context: ${state.totalTokens.toLocaleString()} / ${state.capacity.toLocaleString()} tokens (${percentRounded}%)`,
    "",
    `Input: ${state.input.toLocaleString()}`,
    `Cache read: ${state.cacheRead.toLocaleString()}`,
    `Cache creation: ${state.cacheCreation.toLocaleString()}`,
    `Output: ${state.output.toLocaleString()}`,
  ].join("\n");
}
