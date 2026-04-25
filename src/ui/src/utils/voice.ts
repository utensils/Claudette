import type { VoiceProviderInfo } from "../types/voice";

export function chooseVoiceProvider(
  providers: VoiceProviderInfo[],
): VoiceProviderInfo | null {
  const selected = providers.find((provider) => provider.selected);
  const readyLocal = providers.find(
    (provider) =>
      provider.kind === "local-model" &&
      provider.enabled &&
      provider.status === "ready",
  );
  const platform = providers.find(
    (provider) => provider.id === "voice-platform-system",
  );
  return selected ?? readyLocal ?? platform ?? null;
}

export function insertTranscriptAtSelection(
  text: string,
  transcript: string,
  start: number,
  end: number,
): { text: string; cursor: number } {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
  const needsTrailingSpace = after.length > 0 && !/^\s/.test(after);
  const insertion = `${needsLeadingSpace ? " " : ""}${transcript}${needsTrailingSpace ? " " : ""}`;
  const nextText = before + insertion + after;
  return {
    text: nextText,
    cursor: before.length + insertion.length,
  };
}

