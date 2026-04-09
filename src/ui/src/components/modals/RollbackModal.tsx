import { useState } from "react";
import { useAppStore } from "../../stores/useAppStore";
import { rollbackToCheckpoint } from "../../services/tauri";
import { Modal } from "./Modal";
import shared from "./shared.module.css";

export function RollbackModal() {
  const closeModal = useAppStore((s) => s.closeModal);
  const modalData = useAppStore((s) => s.modalData);
  const rollbackConversation = useAppStore((s) => s.rollbackConversation);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoreFiles, setRestoreFiles] = useState(false);

  const workspaceId = modalData.workspaceId as string;
  const checkpointId = modalData.checkpointId as string;
  const messagePreview = modalData.messagePreview as string;
  const hasCommitHash = modalData.hasCommitHash as boolean;

  const handleRollback = async () => {
    setLoading(true);
    try {
      const messages = await rollbackToCheckpoint(
        workspaceId,
        checkpointId,
        restoreFiles,
      );
      rollbackConversation(workspaceId, checkpointId, messages);
      closeModal();
    } catch (e) {
      setError(String(e));
      setLoading(false);
    }
  };

  return (
    <Modal title="Roll Back Conversation" onClose={closeModal}>
      <div className={shared.warning}>
        Roll back to before this message? All messages after this point will be
        removed.
        {messagePreview && (
          <div style={{ marginTop: 6, opacity: 0.7, fontStyle: "italic" }}>
            &ldquo;{messagePreview}
            {messagePreview.length >= 100 ? "..." : ""}
            &rdquo;
          </div>
        )}
      </div>
      <label className={shared.checkboxRow}>
        <input
          type="checkbox"
          checked={restoreFiles}
          onChange={(e) => setRestoreFiles(e.target.checked)}
          disabled={!hasCommitHash}
        />
        <span>Also restore files to this checkpoint</span>
      </label>
      {!hasCommitHash && (
        <div className={shared.hint}>
          No file checkpoint available for this turn.
        </div>
      )}
      {error && <div className={shared.error}>{error}</div>}
      <div className={shared.actions}>
        <button className={shared.btn} onClick={closeModal}>
          Cancel
        </button>
        <button
          className={shared.btnDanger}
          onClick={handleRollback}
          disabled={loading}
        >
          {loading ? "Rolling back..." : "Roll Back"}
        </button>
      </div>
    </Modal>
  );
}
