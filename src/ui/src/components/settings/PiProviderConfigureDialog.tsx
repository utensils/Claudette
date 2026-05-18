// API-key entry dialog for Pi providers (kind === "api_key").
//
// The "Keep this key private to Claudette" checkbox is the user-
// requested storage opt-out: checked → keychain-only (env-var
// injection), unchecked → writes to Pi's auth.json (shared with
// terminal `pi`). The default depends on whether the user already
// has the provider configured via models.json or an env var — in
// those cases the "shared" path would duplicate state, so we default
// to local.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Modal } from "../modals/Modal";
import shared from "../modals/shared.module.css";
import {
  piClearProviderApiKey,
  piSetProviderApiKey,
  type PiProvider,
} from "../../services/tauri/piProviders";

export interface PiProviderConfigureDialogProps {
  provider: PiProvider;
  workingDir: string;
  onClose: () => void;
  /** Called after a successful save/clear so the parent can refresh. */
  onSaved: () => void;
}

export function PiProviderConfigureDialog({
  provider,
  workingDir,
  onClose,
  onSaved,
}: PiProviderConfigureDialogProps) {
  const { t } = useTranslation("settings");
  const [key, setKey] = useState("");
  // Default the scope based on the current auth source. If the user
  // already has this provider via env var or models.json, keep things
  // local so we don't shadow their existing setup. Otherwise default
  // to shared (matches the team's hybrid storage decision: write to
  // auth.json by default, opt-out for keychain-only).
  const defaultLocal =
    provider.authSource === "environment" ||
    provider.authSource === "models_json_command" ||
    provider.authSource === "models_json_key";
  const [keepPrivate, setKeepPrivate] = useState(defaultLocal);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset state when the dialog is repurposed for a different provider.
  useEffect(() => {
    setKey("");
    setError(null);
    setSubmitting(false);
    setKeepPrivate(defaultLocal);
  }, [provider.id, defaultLocal]);

  const handleSave = async () => {
    if (!key.trim()) {
      setError(t("pi_provider_dialog_empty", "Enter an API key first."));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await piSetProviderApiKey({
        workingDir,
        providerId: provider.id,
        key: key.trim(),
        scope: keepPrivate ? "local" : "shared",
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleClear = async () => {
    setSubmitting(true);
    setError(null);
    try {
      // Clear both scopes — the user is wiping the slate. Without this,
      // a user who switches from shared to local and then wipes would
      // leave the auth.json entry behind.
      await piClearProviderApiKey({
        workingDir,
        providerId: provider.id,
        scope: "shared",
      }).catch(() => {});
      await piClearProviderApiKey({
        workingDir,
        providerId: provider.id,
        scope: "local",
      }).catch(() => {});
      onSaved();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  // Provider-specific env var hint can't be derived from a static
  // string — pull it from the curated entry.
  const envHint = provider.envHint;

  return (
    <Modal
      title={t("pi_provider_dialog_title", {
        label: provider.label,
        defaultValue: "Configure {{label}}",
      })}
      onClose={onClose}
    >
      <p className={shared.warning}>{provider.description}</p>

      <div className={shared.field}>
        <label className={shared.label} htmlFor="pi-provider-key">
          {t("pi_provider_dialog_key_label", "API key")}
        </label>
        <input
          id="pi-provider-key"
          type="password"
          className={shared.input}
          autoFocus
          value={key}
          placeholder={
            provider.configured
              ? t("pi_provider_dialog_replace", "Enter a new key to replace the saved one")
              : t("pi_provider_dialog_paste", "Paste your API key")
          }
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !submitting) void handleSave();
          }}
        />
        {envHint && (
          <p className={shared.hint}>
            {t("pi_provider_dialog_env_hint", {
              name: envHint,
              defaultValue:
                "Tip: set ${{name}} in your shell and Pi picks it up automatically — no need to paste here.",
            })}
          </p>
        )}
        {provider.docsUrl && (
          <p className={shared.hint}>
            <a
              href={provider.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("pi_provider_dialog_get_key", "Get an API key →")}
            </a>
          </p>
        )}
      </div>

      <label className={shared.checkboxRow}>
        <input
          type="checkbox"
          checked={keepPrivate}
          onChange={(e) => setKeepPrivate(e.target.checked)}
        />
        <span>
          {t(
            "pi_provider_dialog_keep_private",
            "Keep this key private to Claudette (do not write to ~/.pi/agent/auth.json)",
          )}
        </span>
      </label>

      {error && <p className={shared.error}>{error}</p>}

      <div className={shared.actions}>
        {provider.configured && (
          <button
            type="button"
            className={shared.btnDanger}
            onClick={handleClear}
            disabled={submitting}
          >
            {t("pi_provider_dialog_clear", "Clear key")}
          </button>
        )}
        <button
          type="button"
          className={shared.btn}
          onClick={onClose}
          disabled={submitting}
        >
          {t("pi_provider_dialog_cancel", "Cancel")}
        </button>
        <button
          type="button"
          className={shared.btnPrimary}
          onClick={handleSave}
          disabled={submitting}
        >
          {submitting
            ? t("pi_provider_dialog_saving", "Saving…")
            : t("pi_provider_dialog_save", "Save")}
        </button>
      </div>
    </Modal>
  );
}
