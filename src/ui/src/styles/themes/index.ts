// Built-in theme metadata. Palettes live in styles/theme.css as
// `[data-theme="..."]` blocks — this file only carries what the settings
// switcher needs: id, display name, description, color-scheme hint.

export interface BuiltinThemeMeta {
  id: string;
  name: string;
  description: string;
  colorScheme: "dark" | "light";
}

export const BUILTIN_THEME_META: BuiltinThemeMeta[] = [
  {
    id: "default-dark",
    name: "Default Dark",
    description: "Claudette's signature theme — coral on warm charcoal",
    colorScheme: "dark",
  },
  {
    id: "default-light",
    name: "Default Light",
    description: "Cream paper with deep coral accents",
    colorScheme: "light",
  },
  {
    id: "jellybeans",
    name: "Jellybeans",
    description: "Dark Vim-inspired palette with cool slate accent",
    colorScheme: "dark",
  },
  {
    id: "high-contrast",
    name: "High Contrast",
    description: "Maximum legibility with cyan accent",
    colorScheme: "dark",
  },
  {
    id: "rose-pine",
    name: "Rosé Pine",
    description: "Soho-vibes dark with iris accent",
    colorScheme: "dark",
  },
  {
    id: "rose-pine-moon",
    name: "Rosé Pine Moon",
    description: "Rosé Pine on warmer navy base",
    colorScheme: "dark",
  },
  {
    id: "rose-pine-dawn",
    name: "Rosé Pine Dawn",
    description: "Rosé Pine light — cream parchment with iris accent",
    colorScheme: "light",
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    description: "Schoonover's canonical dark with blue accent",
    colorScheme: "dark",
  },
  {
    id: "solarized-light",
    name: "Solarized Light",
    description: "Solarized inverted monotones with identical accents",
    colorScheme: "light",
  },
  {
    id: "brink",
    name: "Brink",
    description: "Mid-tone warm chrome with Ristretto-style gold accent",
    colorScheme: "dark",
  },
  {
    id: "jellybeans-muted",
    name: "Jellybeans Muted",
    description: "Softer, desaturated take on Jellybeans",
    colorScheme: "dark",
  },
  {
    id: "midnight-blue",
    name: "Midnight Blue",
    description: "Cool blue-tinted dark theme",
    colorScheme: "dark",
  },
  {
    id: "warm-ember",
    name: "Warm Ember",
    description: "Warm amber-toned dark theme",
    colorScheme: "dark",
  },
  {
    id: "sidekick",
    name: "Sidekick",
    description: "Ship Sidekick brand — deep navy with electric violet",
    colorScheme: "dark",
  },
];

export const BUILTIN_THEME_IDS: ReadonlySet<string> = new Set(
  BUILTIN_THEME_META.map((t) => t.id),
);

export const DEFAULT_THEME_ID = "default-dark";
