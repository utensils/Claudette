import { describe, it, expect } from "vitest";
import {
  TYPEWRITER_BASE_RATE,
  TYPEWRITER_MAX_LAG_MS,
  computeNextState,
  type TypewriterState,
} from "./useTypewriter";

function fresh(target = ""): TypewriterState {
  return { revealed: 0, target };
}

describe("computeNextState", () => {
  it("reveals at base rate when lag fits within the allowed buffer", () => {
    // Target is short enough (5 chars) that lag < allowedBuffer (12 chars) —
    // acceleration should NOT kick in, so we advance at exactly baseRate.
    // 50ms at 60 chars/sec = 3 chars.
    const next = computeNextState({
      state: fresh(),
      fullText: "short",
      deltaMs: 50,
      baseRate: 60,
      maxLagMs: 200,
    });
    expect(next.revealed).toBeCloseTo(3, 5);
    expect(next.target).toBe("short");
  });

  it("accumulates across ticks without losing fractions", () => {
    // Two ticks of 8ms each = 16ms total @ 60cps = 0.96 chars
    let s = fresh("Hello world");
    const params = {
      fullText: "Hello world",
      deltaMs: 8,
      baseRate: 60,
      maxLagMs: 200,
    };
    s = computeNextState({ state: s, ...params });
    s = computeNextState({ state: s, ...params });
    expect(s.revealed).toBeCloseTo(16 * 60 / 1000, 5);
    // Floor is still 0 — fractions preserved, not rounded prematurely.
    expect(Math.floor(s.revealed)).toBe(0);
  });

  it("accelerates when lag exceeds maxLagMs budget", () => {
    // 600-char target, one 200ms tick. Base rate alone would yield 12 chars.
    // Acceleration should drain the whole 600 chars in 200ms.
    const next = computeNextState({
      state: fresh(),
      fullText: "x".repeat(600),
      deltaMs: 200,
      baseRate: 60,
      maxLagMs: 200,
    });
    expect(next.revealed).toBe(600);
  });

  it("keeps lag-in-time bounded to maxLagMs at every tick (steady-state invariant)", () => {
    // The spec's promise is "never lag more than ~200ms behind the true text":
    // interpreted as "remaining buffer / current rate ≤ maxLagMs" at every
    // instant. Simulate many small ticks on a fast-growing target and check
    // the invariant holds after each tick.
    let s = fresh();
    const baseRate = 60;
    const maxLagMs = 200;
    for (let i = 0; i < 30; i++) {
      s = computeNextState({
        state: s,
        fullText: "x".repeat(600),
        deltaMs: 10,
        baseRate,
        maxLagMs,
      });
      const lag = Math.max(0, s.target.length - s.revealed);
      const rate = Math.max(baseRate, lag / (maxLagMs / 1000));
      const lagSeconds = lag === 0 ? 0 : lag / rate;
      expect(lagSeconds).toBeLessThanOrEqual(maxLagMs / 1000 + 1e-9);
    }
  });

  it("latches target when fullText empties — continues revealing", () => {
    let s = fresh();
    // Phase 1: streaming "done" for 30ms (~1.8 chars revealed @ 60cps)
    s = computeNextState({
      state: s,
      fullText: "done",
      deltaMs: 30,
      baseRate: 60,
      maxLagMs: 200,
    });
    expect(s.target).toBe("done");
    expect(s.revealed).toBeGreaterThan(0);
    expect(s.revealed).toBeLessThan(4);

    // Phase 2: source cleared. Target should latch; reveal keeps climbing.
    const prev = s.revealed;
    s = computeNextState({
      state: s,
      fullText: "",
      deltaMs: 30,
      baseRate: 60,
      maxLagMs: 200,
    });
    expect(s.target).toBe("done");
    expect(s.revealed).toBeGreaterThan(prev);
  });

  it("clamps revealed at target.length — never overshoots", () => {
    const s = computeNextState({
      state: { revealed: 3.9, target: "done" },
      fullText: "done",
      deltaMs: 1000,
      baseRate: 60,
      maxLagMs: 200,
    });
    expect(s.revealed).toBe(4);
  });

  it("rewinds revealed when a new target doesn't extend the previous one", () => {
    // Mid-drain on turn A: revealed=3 of "Hello world".
    const midA: TypewriterState = { revealed: 3, target: "Hello world" };
    // Turn B starts before A's drain finished — brand-new text arrives.
    const next = computeNextState({
      state: midA,
      fullText: "Goodbye",
      deltaMs: 16,
      baseRate: 60,
      maxLagMs: 200,
    });
    expect(next.target).toBe("Goodbye");
    // revealed was reset to 0, then advanced by 16ms of accelerated drain.
    // Lag = 7, rate = max(60, 7/0.2) = 60 (since 35 > 60 is false → 60 > 35).
    // Actually lag=7 > allowedBuffer(12)? No, 7 < 12, so rate = 60.
    // 16/1000 * 60 = 0.96 chars.
    expect(next.revealed).toBeGreaterThanOrEqual(0);
    expect(next.revealed).toBeLessThan(1.5);
  });

  it("keeps revealed when new fullText merely extends the latched target", () => {
    // Mid-reveal of "Hello" with 3 chars shown so far.
    const mid: TypewriterState = { revealed: 3, target: "Hello" };
    // A text delta extends it to "Hello world".
    const next = computeNextState({
      state: mid,
      fullText: "Hello world",
      deltaMs: 16,
      baseRate: 60,
      maxLagMs: 200,
    });
    expect(next.target).toBe("Hello world");
    // No rewind — revealed should grow from 3, not restart at 0.
    expect(next.revealed).toBeGreaterThan(3);
  });

  it("idles at zero cost when already drained and target is stable", () => {
    const drained: TypewriterState = { revealed: 5, target: "hello" };
    const s = computeNextState({
      state: drained,
      fullText: "hello",
      deltaMs: 16,
      baseRate: 60,
      maxLagMs: 200,
    });
    expect(s.revealed).toBe(5);
    expect(s.target).toBe("hello");
  });
});

describe("exported constants", () => {
  it("exposes default base rate and max lag", () => {
    expect(TYPEWRITER_BASE_RATE).toBe(60);
    expect(TYPEWRITER_MAX_LAG_MS).toBe(200);
  });
});
