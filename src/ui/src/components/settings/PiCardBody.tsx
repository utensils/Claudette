// Stacked, full-width body for the Pi card in Settings → Models.
//
// Replaces the 3-column `.backendForm` grid the other backend cards
// use. Pi has more chrome than a custom-openai card (per-provider
// auth list + auto-discovered models + manual override) and trying to
// pack them into three side-by-side columns produced cramped rows
// where labels, descriptions, and action buttons all truncated.
//
// Layout, top to bottom:
//   1. Pi providers — primary action surface, full width.
//   2. Available models — collapsed disclosure (the discovered list
//      grouped by sub-provider; users usually only open this when
//      something looks wrong).
//   3. Advanced → Manual model overrides — collapsed disclosure
//      (rarely used since auto-discovery is the whole Pi card story).
//
// Kept as a separate file so `ModelSettings.tsx` (already large)
// only gains a one-line invocation when `draft.kind === "pi_sdk"`.

import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { AgentBackendModel } from "../../services/tauri";
import { groupPiDiscoveredModels } from "../chat/modelRegistry";
import { PiProviderManager } from "./PiProviderManager";
import styles from "./PiCardLayout.module.css";

export interface PiCardBodyProps {
  discoveredModels: AgentBackendModel[];
  manualModelText: string;
  onChangeManualModels: (next: string) => void;
  /** Fired after a provider auth round-trip succeeds. Triggers the
   *  parent's `refresh()` so `discoveredModels` repopulates. */
  onProviderConfigured: () => void;
}

export function PiCardBody({
  discoveredModels,
  manualModelText,
  onChangeManualModels,
  onProviderConfigured,
}: PiCardBodyProps) {
  const { t } = useTranslation("settings");

  return (
    <div className={styles.stack}>
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionLabel}>
            {t("pi_card_providers_label", "Providers")}
          </span>
        </div>
        <PiProviderManager workingDir="" onConfigured={onProviderConfigured} />
      </section>

      <AvailableModelsDisclosure models={discoveredModels} />

      <AdvancedDisclosure>
        <ManualModelOverrides
          value={manualModelText}
          onChange={onChangeManualModels}
        />
      </AdvancedDisclosure>
    </div>
  );
}

interface AvailableModelsDisclosureProps {
  models: AgentBackendModel[];
}

/** Disclosure wrapper that uses a header `<button>` for keyboard /
 *  screen reader semantics and renders the body as a sibling `<div>`,
 *  avoiding the "interactive elements inside a button" a11y antipattern
 *  the previous structure would have introduced once the Advanced
 *  body grew an `<input>`. */
function Disclosure({
  label,
  meta,
  open,
  onToggle,
  children,
}: {
  label: string;
  meta?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.disclosure}>
      <button
        type="button"
        className={styles.disclosureHeader}
        style={{ width: "100%", background: "transparent", border: "none", cursor: "pointer" }}
        aria-expanded={open}
        onClick={onToggle}
      >
        <ChevronRight
          size={12}
          className={`${styles.disclosureChevron} ${open ? styles.disclosureChevronOpen : ""}`}
          aria-hidden
        />
        <span className={styles.disclosureLabel}>{label}</span>
        {meta && <span className={styles.disclosureCount}>{meta}</span>}
      </button>
      {open && <div className={styles.disclosureBody}>{children}</div>}
    </div>
  );
}

function AvailableModelsDisclosure({ models }: AvailableModelsDisclosureProps) {
  const { t } = useTranslation("settings");
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => groupPiDiscoveredModels(models), [models]);
  const total = models.length;

  return (
    <Disclosure
      label={t("pi_card_available_models", "Available models")}
      meta={t("pi_card_available_models_count", {
        providers: groups.length,
        models: total,
        defaultValue: "{{providers}} providers · {{models}} models",
      })}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      {groups.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {t(
            "pi_card_available_empty",
            "No models discovered yet. Configure a provider above to populate this list.",
          )}
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {groups.map((group) => (
            <li key={group.key} style={{ fontSize: 12 }}>
              <span style={{ color: "var(--text-primary)" }}>{group.label}</span>
              <span style={{ color: "var(--text-dim)", marginLeft: 8 }}>
                {group.models.length}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Disclosure>
  );
}

function AdvancedDisclosure({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation("settings");
  const [open, setOpen] = useState(false);
  return (
    <Disclosure
      label={t("pi_card_advanced", "Advanced")}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      {children}
    </Disclosure>
  );
}

interface ManualModelOverridesProps {
  value: string;
  onChange: (next: string) => void;
}

function ManualModelOverrides({ value, onChange }: ManualModelOverridesProps) {
  const { t } = useTranslation("settings");
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <label style={{ display: "block" }}>
        <span
          style={{
            display: "block",
            color: "var(--text-dim)",
            fontSize: 11,
            fontWeight: 500,
            marginBottom: 4,
          }}
        >
          {t("pi_card_manual_models", "Manual model overrides")}
        </span>
        <input
          className={styles.manualModelsInput}
          value={value}
          placeholder={t(
            "pi_card_manual_placeholder",
            "Comma-separated provider/model ids",
          )}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      <p className={styles.manualModelsHint}>
        {t(
          "pi_card_manual_hint",
          "Optional. Use when Pi's auto-discovery misses a model — manual entries appear alongside discovered ones in the chat picker.",
        )}
      </p>
    </div>
  );
}
