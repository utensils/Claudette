import { describe, expect, it } from "vitest";

import type { VoiceProviderInfo } from "../types/voice";
import { chooseVoiceProvider, insertTranscriptAtSelection } from "./voice";

function provider(
  overrides: Partial<VoiceProviderInfo> & Pick<VoiceProviderInfo, "id">,
): VoiceProviderInfo {
  const { id, ...rest } = overrides;
  return {
    id,
    name: id,
    description: "",
    kind: "platform",
    privacyLabel: "",
    offline: false,
    downloadRequired: false,
    modelSizeLabel: null,
    cachePath: null,
    acceleratorLabel: null,
    status: "ready",
    statusLabel: "Ready",
    enabled: true,
    selected: false,
    setupRequired: false,
    canRemoveModel: false,
    error: null,
    ...rest,
  };
}

describe("chooseVoiceProvider", () => {
  it("prefers the explicitly selected provider", () => {
    const selected = provider({
      id: "voice-distil-whisper-candle",
      kind: "local-model",
      selected: true,
      status: "needs-setup",
    });
    expect(
      chooseVoiceProvider([
        provider({ id: "voice-platform-system" }),
        selected,
      ]),
    ).toBe(selected);
  });

  it("prefers a ready local provider before platform fallback", () => {
    const local = provider({
      id: "voice-distil-whisper-candle",
      kind: "local-model",
      status: "ready",
    });
    expect(
      chooseVoiceProvider([
        provider({ id: "voice-platform-system" }),
        local,
      ]),
    ).toBe(local);
  });

  it("falls back to platform when local providers need setup", () => {
    const platform = provider({ id: "voice-platform-system" });
    expect(
      chooseVoiceProvider([
        provider({
          id: "voice-distil-whisper-candle",
          kind: "local-model",
          status: "needs-setup",
        }),
        platform,
      ]),
    ).toBe(platform);
  });

  it("falls back to platform when local provider engine is unavailable", () => {
    const platform = provider({ id: "voice-platform-system" });
    expect(
      chooseVoiceProvider([
        provider({
          id: "voice-distil-whisper-candle",
          kind: "local-model",
          status: "engine-unavailable",
        }),
        platform,
      ]),
    ).toBe(platform);
  });

  it("does not choose a disabled platform provider", () => {
    expect(
      chooseVoiceProvider([
        provider({
          id: "voice-platform-system",
          enabled: false,
          status: "unavailable",
        }),
      ]),
    ).toBeNull();
  });
});

describe("insertTranscriptAtSelection", () => {
  it("inserts transcript at the cursor with readable spacing", () => {
    expect(insertTranscriptAtSelection("hello world", "there", 5, 5)).toEqual({
      text: "hello there world",
      cursor: 11,
    });
  });

  it("replaces the selected range and preserves adjacent whitespace", () => {
    expect(insertTranscriptAtSelection("run old command", "new", 4, 7)).toEqual({
      text: "run new command",
      cursor: 7,
    });
  });

  it("does not add leading whitespace at the beginning", () => {
    expect(insertTranscriptAtSelection("", "hello", 0, 0)).toEqual({
      text: "hello",
      cursor: 5,
    });
  });
});
