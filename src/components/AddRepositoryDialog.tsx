import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useApp } from "../contexts/AppContext";

interface Props {
  onClose: () => void;
}

export function AddRepositoryDialog({ onClose }: Props) {
  const { addRepository } = useApp();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleBrowse() {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;

    setLoading(true);
    setError(null);
    try {
      await addRepository(selected);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add Repository</h2>
          <button className="btn-icon" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-body">
          <p className="modal-description">
            Select a git repository folder to add to Claudette.
          </p>
          {error && <div className="modal-error">{error}</div>}
          <button
            className="btn btn-primary"
            onClick={handleBrowse}
            disabled={loading}
            style={{ width: "100%" }}
          >
            {loading ? "Adding..." : "Browse for Repository"}
          </button>
        </div>
      </div>
    </div>
  );
}
