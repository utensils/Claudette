import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (vi.hoisted runs before vi.mock factories) ────────────────
const { mockCheck, mockSetUpdateAvailable } = vi.hoisted(() => ({
  mockCheck: vi.fn(),
  mockSetUpdateAvailable: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: mockCheck,
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(),
}));

vi.mock("../stores/useAppStore", () => ({
  useAppStore: Object.assign(() => null, {
    getState: () => ({
      setUpdateAvailable: mockSetUpdateAvailable,
      updateDownloading: false,
      workspaces: [],
    }),
  }),
}));

// ── Import under test (after mocks) ─────────────────────────────────
import { checkForUpdate } from "./useAutoUpdater";

describe("checkForUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns "available" and sets store when an update exists', async () => {
    mockCheck.mockResolvedValue({ version: "2.0.0" });

    const result = await checkForUpdate();

    expect(result).toBe("available");
    expect(mockSetUpdateAvailable).toHaveBeenCalledWith(true, "2.0.0");
  });

  it('returns "up-to-date" and clears store when no update exists', async () => {
    mockCheck.mockResolvedValue(null);

    const result = await checkForUpdate();

    expect(result).toBe("up-to-date");
    expect(mockSetUpdateAvailable).toHaveBeenCalledWith(false, null);
  });

  it('returns "error" and does not touch store when check throws', async () => {
    mockCheck.mockRejectedValue(new Error("network failure"));

    const result = await checkForUpdate();

    expect(result).toBe("error");
    expect(mockSetUpdateAvailable).not.toHaveBeenCalled();
  });
});
