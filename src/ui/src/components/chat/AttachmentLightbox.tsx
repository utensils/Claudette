import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import type { DownloadableAttachment } from "../../utils/attachmentDownload";
import styles from "./AttachmentLightbox.module.css";

interface AttachmentLightboxProps {
  attachment: DownloadableAttachment;
  /** Element to return focus to on close — typically the originating <img>. */
  returnFocusTo?: HTMLElement | null;
  onClose: () => void;
}

export function AttachmentLightbox({
  attachment,
  returnFocusTo,
  onClose,
}: AttachmentLightboxProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const imageWrapRef = useRef<HTMLDivElement>(null);

  // Focus the close button on open, restore to the trigger on close.
  useEffect(() => {
    const previouslyFocused = returnFocusTo ?? null;
    closeBtnRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, [returnFocusTo]);

  // Escape, Tab trap. Capture phase so we swallow Escape before any
  // underlying context-menu handler also bound at capture.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab") {
        // Two focusable targets — cycle between them so focus can't escape
        // the overlay while it's open.
        const close = closeBtnRef.current;
        const wrap = imageWrapRef.current;
        if (!close || !wrap) return;
        const active = document.activeElement;
        if (e.shiftKey) {
          if (active === close) {
            e.preventDefault();
            wrap.focus();
          }
        } else if (active === wrap) {
          e.preventDefault();
          close.focus();
        }
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Prevent background scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  function onBackdropMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    // Only dismiss when the click lands on the backdrop itself, not on the
    // image, caption, or close button.
    if (e.target === backdropRef.current) onClose();
  }

  const src = `data:${attachment.media_type};base64,${attachment.data_base64}`;

  const overlay = (
    <div
      ref={backdropRef}
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={attachment.filename}
      onMouseDown={onBackdropMouseDown}
      data-testid="attachment-lightbox"
    >
      <button
        ref={closeBtnRef}
        type="button"
        className={styles.closeBtn}
        aria-label="Close image preview"
        onClick={onClose}
      >
        <X size={18} />
      </button>
      <div ref={imageWrapRef} className={styles.imageWrap} tabIndex={-1}>
        <img
          src={src}
          alt={attachment.filename}
          className={styles.image}
          draggable={false}
        />
      </div>
      <div className={styles.caption}>{attachment.filename}</div>
    </div>
  );

  return typeof document === "undefined"
    ? overlay
    : createPortal(overlay, document.body);
}
