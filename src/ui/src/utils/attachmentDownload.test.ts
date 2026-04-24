import { describe, it, expect, vi } from "vitest";
import {
  extensionFor,
  downloadAttachment,
  openAttachmentInBrowser,
  type DownloadableAttachment,
} from "./attachmentDownload";

const fixture: DownloadableAttachment = {
  filename: "screenshot.png",
  media_type: "image/png",
  data_base64: "aGVsbG8=", // "hello"
};

describe("extensionFor", () => {
  it("derives from media_type", () => {
    expect(extensionFor(fixture)).toBe("png");
  });

  it("strips +xml / +json suffixes", () => {
    expect(
      extensionFor({ ...fixture, media_type: "image/svg+xml" }),
    ).toBe("svg");
  });

  it("falls back to filename extension when media_type is opaque", () => {
    expect(
      extensionFor({
        ...fixture,
        filename: "doc.pdf",
        media_type: "application/x-something totally weird",
      }),
    ).toBe("pdf");
  });

  it("falls back to bin as last resort", () => {
    expect(
      extensionFor({
        filename: "noextension",
        media_type: "application/x has a space",
        data_base64: "",
      }),
    ).toBe("bin");
  });
});

describe("downloadAttachment", () => {
  it("returns null and skips invoke when user cancels the dialog", async () => {
    const save = vi.fn().mockResolvedValue(null);
    const invoke = vi.fn();

    const result = await downloadAttachment(fixture, {
      save,
      invoke,
    });

    expect(result).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][0]).toMatchObject({
      defaultPath: "screenshot.png",
      filters: [{ name: "image/png", extensions: ["png"] }],
    });
  });

  it("writes bytes to the chosen path and returns it", async () => {
    const save = vi.fn().mockResolvedValue("/tmp/out.png");
    const invoke = vi.fn().mockResolvedValue(undefined);

    const result = await downloadAttachment(fixture, {
      save,
      invoke,
    });

    expect(result).toBe("/tmp/out.png");
    expect(invoke).toHaveBeenCalledWith("save_attachment_bytes", {
      path: "/tmp/out.png",
      bytes: [104, 101, 108, 108, 111], // "hello"
    });
  });

  it("propagates errors from invoke (e.g. disk full)", async () => {
    const save = vi.fn().mockResolvedValue("/tmp/out.png");
    const invoke = vi.fn().mockRejectedValue(new Error("ENOSPC"));

    await expect(
      downloadAttachment(fixture, { save, invoke }),
    ).rejects.toThrow("ENOSPC");
  });
});

describe("openAttachmentInBrowser", () => {
  it("invokes the backend with decoded bytes, filename, and mediaType", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);

    await openAttachmentInBrowser(fixture, { invoke });

    expect(invoke).toHaveBeenCalledWith("open_attachment_in_browser", {
      bytes: [104, 101, 108, 108, 111],
      filename: "screenshot.png",
      mediaType: "image/png",
    });
  });
});
