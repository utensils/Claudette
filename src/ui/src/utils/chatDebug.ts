declare global {
  interface Window {
    __CLAUDETTE_CHAT_DEBUG__?: boolean;
    __CLAUDETTE_STORE__?: typeof import("../stores/useAppStore").useAppStore;
    __CLAUDETTE_INVOKE__?: typeof import("@tauri-apps/api/core").invoke;
  }
}

function isChatDebugEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  if (typeof window === "undefined") return true;
  return window.__CLAUDETTE_CHAT_DEBUG__ !== false;
}

export function debugChat(
  scope: string,
  event: string,
  payload?: Record<string, unknown>,
): void {
  if (!isChatDebugEnabled()) return;

  const prefix = `[chat-debug][${scope}] ${event}`;
  if (payload) {
    console.debug(prefix, payload);
    return;
  }
  console.debug(prefix);
}
