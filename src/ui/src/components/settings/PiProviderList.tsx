// Provider list rendered inside the Settings → Models → Pi card and
// inside the `/login` provider picker modal. The list itself is pure
// presentation; the configure-action wiring (open the right dialog
// for `kind`) lives in the parent so `/login` can swap in its own
// after-success callback (resume the chat) without duplicating the
// list logic.
//
// Kept deliberately small — no fetch, no state machine. The parent
// owns `loading` / `error` and the curated list, refreshes after a
// configure round-trip, and decides whether to show the disclosure.

import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { PiProvider } from "../../services/tauri/piProviders";
import styles from "./PiProviderList.module.css";

export interface PiProviderListProps {
  providers: PiProvider[];
  defaultVisibleCount: number;
  /** Disabled while a request is in flight (configure or refresh). */
  busy?: boolean;
  /** Configure the API key or launch OAuth. The handler dispatches on
   *  `provider.kind`. */
  onConfigure: (provider: PiProvider) => void;
  /** Optional: show a "Clear" button on configured rows. Defaults to
   *  enabled. The `/login` picker can disable it to keep that flow
   *  one-shot. */
  onClear?: (provider: PiProvider) => void;
  /** Optional: text to render under the list (count summary etc.). */
  footer?: React.ReactNode;
}

export function PiProviderList({
  providers,
  defaultVisibleCount,
  busy,
  onConfigure,
  onClear,
  footer,
}: PiProviderListProps) {
  const { t } = useTranslation("settings");
  const [showAll, setShowAll] = useState(false);

  const visible = useMemo(() => {
    if (showAll) return providers;
    return providers.slice(0, defaultVisibleCount);
  }, [providers, defaultVisibleCount, showAll]);

  const hiddenCount = providers.length - visible.length;
  const configuredCount = providers.filter((p) => p.configured).length;
  const totalModels = providers.reduce((acc, p) => acc + p.modelCount, 0);

  if (providers.length === 0) {
    return (
      <div className={styles.empty}>
        {t(
          "pi_providers_empty",
          "Pi reported no providers. Refresh, or check that the sidecar is healthy.",
        )}
      </div>
    );
  }

  return (
    <>
      <div className={styles.summary}>
        <span>
          {t("pi_providers_summary", {
            configured: configuredCount,
            total: providers.length,
            models: totalModels,
            defaultValue:
              "{{configured}}/{{total}} configured · {{models}} models available",
          })}
        </span>
      </div>
      <div className={styles.list}>
        {visible.map((provider) => (
          <PiProviderRow
            key={provider.id}
            provider={provider}
            busy={busy}
            onConfigure={onConfigure}
            onClear={onClear}
          />
        ))}
      </div>
      {hiddenCount > 0 && (
        <button
          type="button"
          className={styles.disclosure}
          onClick={() => setShowAll(true)}
        >
          <ChevronRight size={12} aria-hidden />
          {t("pi_providers_show_more", {
            count: hiddenCount,
            defaultValue: "More providers ({{count}})",
          })}
        </button>
      )}
      {showAll && hiddenCount === 0 && providers.length > defaultVisibleCount && (
        <button
          type="button"
          className={styles.disclosure}
          onClick={() => setShowAll(false)}
        >
          <ChevronDown size={12} aria-hidden />
          {t("pi_providers_show_less", "Show fewer providers")}
        </button>
      )}
      {footer}
    </>
  );
}

interface PiProviderRowProps {
  provider: PiProvider;
  busy?: boolean;
  onConfigure: (provider: PiProvider) => void;
  onClear?: (provider: PiProvider) => void;
}

function PiProviderRow({
  provider,
  busy,
  onConfigure,
  onClear,
}: PiProviderRowProps) {
  const { t } = useTranslation("settings");

  const isEnvOnly = provider.kind === "env_only";
  const statusDotClass = [
    styles.statusDot,
    provider.configured && styles.statusDotConfigured,
    !provider.configured && isEnvOnly && styles.statusDotEnvOnly,
  ]
    .filter(Boolean)
    .join(" ");

  // Action button label depends on kind + state. OAuth providers say
  // "Sign in" / "Sign out"; API-key providers say "Configure" / "Clear".
  // env_only providers point at docs.
  const actionLabel = (() => {
    if (isEnvOnly) {
      return t("pi_provider_view_docs", "Docs");
    }
    if (provider.kind.startsWith("oauth")) {
      return provider.configured
        ? t("pi_provider_signout", "Sign out")
        : t("pi_provider_signin", "Sign in");
    }
    return provider.configured
      ? t("pi_provider_reconfigure", "Reconfigure")
      : t("pi_provider_configure", "Configure");
  })();

  // Show the auth source label for already-configured providers so a
  // user with both an env var and an auth.json entry can tell which
  // one Pi will use.
  const sourceLabel = (() => {
    if (!provider.configured) {
      if (provider.envHint) {
        return t("pi_provider_env_hint", {
          name: provider.envHint,
          defaultValue: "or set ${{name}}",
        });
      }
      return undefined;
    }
    switch (provider.authSource) {
      case "stored":
        return t("pi_provider_source_stored", "via auth.json");
      case "environment":
        return t("pi_provider_source_env", {
          name: provider.envHint ?? "env var",
          defaultValue: "via ${{name}}",
        });
      case "runtime":
        return t("pi_provider_source_runtime", "via --api-key");
      case "fallback":
      case "models_json_key":
      case "models_json_command":
        return t("pi_provider_source_models_json", "via models.json");
      default:
        return undefined;
    }
  })();

  return (
    <div className={styles.row}>
      <span className={statusDotClass} aria-hidden />
      <div className={styles.body}>
        <span className={styles.label}>
          {provider.label}
          {provider.modelCount > 0 && (
            <span style={{ marginLeft: 8, color: "var(--text-dim)", fontWeight: 400 }}>
              {provider.modelCount} models
            </span>
          )}
        </span>
        <span className={styles.description}>{provider.description}</span>
      </div>
      {sourceLabel && <span className={styles.source}>{sourceLabel}</span>}
      <div style={{ display: "flex", gap: 6 }}>
        {provider.configured && onClear && !isEnvOnly && (
          <button
            type="button"
            className={styles.btn}
            onClick={() => onClear(provider)}
            disabled={busy}
          >
            {t("pi_provider_clear", "Clear")}
          </button>
        )}
        <button
          type="button"
          className={
            provider.configured && !isEnvOnly ? styles.btn : styles.btnPrimary
          }
          onClick={() => {
            if (isEnvOnly && provider.docsUrl) {
              window.open(provider.docsUrl, "_blank", "noopener,noreferrer");
              return;
            }
            onConfigure(provider);
          }}
          disabled={busy}
        >
          {isEnvOnly && <ExternalLink size={11} aria-hidden style={{ marginRight: 4 }} />}
          {actionLabel}
        </button>
      </div>
    </div>
  );
}
