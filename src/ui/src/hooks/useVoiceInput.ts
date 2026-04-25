import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listVoiceProviders } from "../services/voice";
import type { VoiceProviderInfo } from "../types/voice";

type VoiceState =
  | "idle"
  | "setup-required"
  | "recording"
  | "transcribing"
  | "error";

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  length: number;
  item(index: number): SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike;
}

interface SpeechRecognitionWindow extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

export interface VoiceInputController {
  state: VoiceState;
  elapsedSeconds: number;
  interimTranscript: string;
  error: string | null;
  activeProvider: VoiceProviderInfo | null;
  platformSupported: boolean;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
}

export function useVoiceInput(
  onTranscript: (transcript: string) => void,
  onNeedsSetup: () => void,
): VoiceInputController {
  const [state, setState] = useState<VoiceState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activeProvider, setActiveProvider] = useState<VoiceProviderInfo | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTranscriptRef = useRef("");
  const cancelledRef = useRef(false);

  const Recognition = useMemo(() => {
    if (typeof window === "undefined") return undefined;
    const speechWindow = window as SpeechRecognitionWindow;
    return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
  }, []);

  const platformSupported = Boolean(Recognition);

  useEffect(() => {
    if (state !== "recording") {
      setElapsedSeconds(0);
      return;
    }
    const started = Date.now();
    const interval = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - started) / 1000));
    }, 250);
    return () => window.clearInterval(interval);
  }, [state]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    finalTranscriptRef.current = "";
    setInterimTranscript("");
    setState("idle");
  }, []);

  useEffect(() => cancel, [cancel]);

  const start = useCallback(async () => {
    setError(null);
    setInterimTranscript("");
    finalTranscriptRef.current = "";
    cancelledRef.current = false;

    let providers: VoiceProviderInfo[];
    try {
      providers = await listVoiceProviders();
    } catch (err) {
      setError(String(err));
      setState("error");
      return;
    }

    const selected = providers.find((provider) => provider.selected);
    const platform = providers.find((provider) => provider.id === "voice-platform-system");
    const readyLocal = providers.find(
      (candidate) =>
        candidate.kind === "local-model" &&
        candidate.enabled &&
        candidate.status === "ready",
    );
    const provider = selected ?? readyLocal ?? platform ?? null;
    setActiveProvider(provider);

    if (!provider) {
      setError("No voice provider is available.");
      setState("error");
      return;
    }

    if (provider.id !== "voice-platform-system") {
      if (provider.setupRequired || provider.status !== "ready") {
        setState("setup-required");
        onNeedsSetup();
        return;
      }
      setError("This local provider is installed, but native transcription is not enabled in this build yet.");
      setState("error");
      return;
    }

    if (!Recognition) {
      setError("System dictation is not available in this webview.");
      setState("error");
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    recognition.onstart = () => {
      setState("recording");
    };
    recognition.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results.item(index);
        const transcript = result.length > 0 ? result.item(0).transcript : "";
        if (result.isFinal) finalTranscriptRef.current += transcript;
        else interim += transcript;
      }
      setInterimTranscript(interim.trim());
    };
    recognition.onerror = (event) => {
      if (cancelledRef.current) return;
      setError(event.message || event.error || "Voice input failed.");
      setState("error");
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      if (cancelledRef.current) return;
      setState("transcribing");
      const transcript = finalTranscriptRef.current.trim();
      finalTranscriptRef.current = "";
      setInterimTranscript("");
      if (transcript) onTranscript(transcript);
      setState("idle");
    };
    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (err) {
      recognitionRef.current = null;
      setError(String(err));
      setState("error");
    }
  }, [Recognition, onNeedsSetup, onTranscript]);

  const stop = useCallback(() => {
    if (!recognitionRef.current) return;
    setState("transcribing");
    recognitionRef.current.stop();
  }, []);

  return {
    state,
    elapsedSeconds,
    interimTranscript,
    error,
    activeProvider,
    platformSupported,
    start,
    stop,
    cancel,
  };
}
