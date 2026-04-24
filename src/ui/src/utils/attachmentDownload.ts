import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

import { base64ToBytes } from "./base64";

/**
 * Minimal shape an attachment needs to expose for Download / Open In Browser.
 * Accepts either the persisted `ChatAttachment` (data_base64) or the staged
 * `PendingAttachment` (same field name) — both carry base64 bytes.
 */
export interface DownloadableAttachment {
  filename: string;
  media_type: string;
  data_base64: string;
}

/**
 * `image/png` → `png`. Falls back to the current filename's extension, then to
 * `bin`. Keeps the save dialog's filter name accurate for uncommon types.
 */
export function extensionFor(attachment: DownloadableAttachment): string {
  const fromMedia = attachment.media_type.split("/").pop();
  if (fromMedia && /^[a-z0-9+.-]+$/i.test(fromMedia)) {
    return fromMedia.replace("+xml", "").replace("+json", "");
  }
  const dot = attachment.filename.lastIndexOf(".");
  if (dot > 0 && dot < attachment.filename.length - 1) {
    return attachment.filename.slice(dot + 1);
  }
  return "bin";
}

/**
 * Prompt the user with a native save dialog, then write the attachment bytes
 * to the chosen path. Returns the saved path on success, or `null` if the
 * user cancelled the dialog.
 *
 * `saveImpl` and `invokeImpl` are injectable so unit tests don't need to hit
 * the real Tauri IPC; production code uses the module-level Tauri bindings.
 */
export async function downloadAttachment(
  attachment: DownloadableAttachment,
  deps: {
    save?: typeof save;
    invoke?: typeof invoke;
  } = {},
): Promise<string | null> {
  const saveFn = deps.save ?? save;
  const invokeFn = deps.invoke ?? invoke;

  const ext = extensionFor(attachment);
  const path = await saveFn({
    defaultPath: attachment.filename,
    filters: [
      {
        name: attachment.media_type || "File",
        extensions: [ext],
      },
    ],
  });

  if (!path) {
    return null;
  }

  const bytes = base64ToBytes(attachment.data_base64);
  await invokeFn("save_attachment_bytes", {
    path,
    bytes: Array.from(bytes),
  });
  return path;
}

/**
 * Write the attachment to a temp HTML wrapper and open it with the system
 * default handler (routes to the user's browser because the wrapper is .html).
 * Resolves once the open command has been dispatched; the backend is
 * fire-and-forget after that.
 */
export async function openAttachmentInBrowser(
  attachment: DownloadableAttachment,
  deps: { invoke?: typeof invoke } = {},
): Promise<void> {
  const invokeFn = deps.invoke ?? invoke;
  const bytes = base64ToBytes(attachment.data_base64);
  await invokeFn("open_attachment_in_browser", {
    bytes: Array.from(bytes),
    filename: attachment.filename,
    mediaType: attachment.media_type,
  });
}
