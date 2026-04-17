# Theming Claudette

Claudette ships with one built-in theme (`default`) and loads any `*.json` theme file placed in `~/.claudette/themes/` at startup. A theme is a JSON document describing **design tokens** (colors, elevation, typography, radii, motion, layout) — each token maps 1:1 to a CSS custom property on `:root`.

This doc is the authoring reference. The JSON schema at `src/ui/src/styles/themes/theme.schema.json` is the machine-readable version; point your editor at it for autocomplete and inline validation.

---

## Quick start

1. Create `~/.claudette/themes/my-theme.json`.
2. Copy the skeleton below and start replacing values.
3. Restart Claudette (or reload — themes are re-read on app start).
4. Pick your theme in **Settings → Appearance**.

```json
{
  "$schema": "https://claudette.app/schemas/theme.schema.json",
  "manifest": {
    "id": "my-theme",
    "name": "My Theme",
    "author": "you",
    "version": "1.0.0",
    "scheme": "dark",
    "description": "One-line tagline.",
    "preview": {
      "background": "#0e0e12",
      "surface": "#161620",
      "accent": "#00e5cc",
      "text": "#ebebf0"
    }
  },
  "tokens": {
    "color": {
      "color-scheme": "dark",
      "app-bg": "#0e0e12",
      "panel-bg": "#16161d",
      "surface-bg": "#1a1a22",
      "sunken-bg": "#0a0a0e",
      "text-primary": "#ebebf0",
      "accent-primary": "#00e5cc",
      "accent-primary-rgb": "0, 229, 204"
    }
  }
}
```

That's enough to boot. Any token you omit inherits the built-in default from `src/ui/src/styles/theme.css`.

---

## How it works

1. At app start, `utils/theme.ts` loads every JSON theme (built-in + `~/.claudette/themes/`).
2. When you pick a theme, `applyTheme()` walks the `tokens` tree, flattens group/token → `--token` CSS variable, and sets them on `:root`.
3. Group names (`color`, `typography`, …) are **organizational only** — they don't appear in CSS variable names. A `tokens.color.accent-primary` value becomes `--accent-primary`, not `--color-accent-primary`.
4. Tokens *not* in the allowlist (`THEMEABLE_TOKENS` in `utils/theme.ts`) are silently ignored with a console warning. This prevents typos and stray keys from polluting `:root`.
5. A missing token falls back to the `:root` default in `theme.css`.

## Manifest fields

| Field | Required | Purpose |
|---|---|---|
| `id` | yes | Unique kebab-case identifier (`my-theme`, `rose-pine-moon`). |
| `name` | yes | Label in the theme picker. |
| `author` | no | Attribution. |
| `version` | no | Semver (`1.0.0`). Theme picker may show on hover. |
| `scheme` | no | `"dark"` or `"light"`. Sets native `color-scheme`, picks a matching syntax-highlight theme for code blocks, and hints the theme picker preview. Defaults to `"dark"`. |
| `description` | no | One-line tagline under the name. |
| `preview` | no | Swatches shown in the theme-picker tile. If omitted, the picker reads tokens directly. |

## Token groups

Every token below is a CSS variable with a built-in default. Override any subset.

### `color` — surfaces, text, semantic colors

#### Substrate layers (depth without borders)

| Token | What it controls |
|---|---|
| `app-bg` | Outermost window background. |
| `panel-bg` | Sidebar, right rail, other flanking panels. |
| `surface-bg` | Raised surfaces (chat canvas). Sits visually *above* the panels. |
| `sunken-bg` | Recessed wells — the composer, code blocks, tool detail. |

**Recipe**: grade dark themes from near-black (`app-bg`) up through subtly lighter shades. Light themes invert.

#### Text

| Token | Typical use |
|---|---|
| `text-primary` | Body text, headings. |
| `text-muted` | Secondary labels. |
| `text-dim` | Captions, timestamps. |
| `text-faint` | Placeholder text, disabled. |
| `text-separator` | Hairline rules and disabled borders. |

#### Accent (the brand wire)

| Token | Use |
|---|---|
| `accent-primary` | The single accent color. Used as a hairline wire, not a fill. |
| `accent-primary-rgb` | RGB triple for `rgba()` — e.g. `"0, 229, 204"`. |
| `accent-dim` | Darker accent for hover/active states. |
| `accent-bg`, `accent-bg-strong` | Low-alpha tints of the accent. |
| `accent-glow` | Optional `box-shadow` used on running indicators. |

#### Interactive

| Token | Use |
|---|---|
| `hover-bg` / `hover-bg-subtle` | Row / button hover backgrounds. |
| `selected-bg` | Selected workspace, highlighted item. |
| `divider` | Very-low-contrast rules (used sparingly — depth is preferred). |
| `selection-bg` | Text `::selection` background. |

#### Status / badges

`status-running` · `status-idle` · `status-stopped` · `badge-done` · `badge-plan` · `badge-ask`

#### Diff

`diff-added-bg` · `diff-removed-bg` · `diff-added-text` · `diff-removed-text` · `diff-hunk-header` · `diff-line-number`

#### Chat, terminal, toolbar, errors, overlays

See `theme.css` for the full list. Every `--var` declared there is overridable.

#### Atmosphere

| Token | Use |
|---|---|
| `canvas-atmosphere` | `background` value applied behind the chat canvas. Use `none` to disable, or replace with your own gradients. |
| `rim-light` / `rim-light-strong` | Full `box-shadow` values (typically `inset 0 1px 0 <color>`) applied as 1px top-edge highlights on raised surfaces. Use `none` to disable. |

### `elevation` — shadow language

| Token | Use |
|---|---|
| `shadow-sm` / `shadow-md` / `shadow-lg` | Ambient elevation scale. |
| `shadow-card-hover` | Hover state for workspace tiles, cards. |
| `well-shadow` | Inset shadow for sunken surfaces (composer). |
| `composer-ring` | `box-shadow` on the chat composer at rest. |
| `composer-ring-focus` | `box-shadow` on the chat composer when focused. |

**Tip**: pick one directional light (e.g. top-right) and keep every shadow consistent. Don't mix `rgba(0,0,0,…)` with `rgba(accent,…)` randomly — pick *one* shadow tint per theme.

### `typography`

Typographic **scale** only — sizes, weights, line-heights, letter-spacing. Font **families** are intentionally NOT themable so every theme shares a consistent typographic voice. Users who want different fonts set them in **Settings → Appearance**, which applies on top of the theme.

| Token | Default | Notes |
|---|---|---|
| `font-size-sm` / `-base` / `-md` / `-lg` | 11 / 13 / 14 / 16 px | Use these instead of raw `px` in component CSS. |
| `font-weight-regular` / `-medium` / `-semibold` / `-bold` | 400 / 500 / 600 / 700 | |
| `line-height-tight` / `-normal` / `-relaxed` | 1.3 / 1.55 / 1.7 | |
| `letter-spacing-tight` / `-wide` | -0.01em / 0.05em | |

> ⚠️ Declaring `font-sans` or `font-mono` in a theme has no effect — they're outside the allowlist. A console warning flags ignored tokens.

### `radius`

| Token | Default | Use |
|---|---|---|
| `radius-sm` | 4px | Small chips, scrollbar thumb. |
| `radius-md` | 8px | Buttons, badges, cards. |
| `radius-lg` | 14px | Major panels, the composer slab. |
| `radius-pill` | 999px | Full-pill buttons, capsule badges. |
| `border-radius` | alias for `radius-md` | Legacy catch-all; prefer the scale. |

### `spacing`

`space-xs` · `space-sm` · `space-md` · `space-lg` · `space-xl` (default 4 / 8 / 12 / 16 / 24 px). Primarily consumed by component CSS — overriding here rescales the UI density globally.

### `motion`

| Token | Default | Use |
|---|---|---|
| `transition-fast` | `0.12s ease` | Snappy color transitions. |
| `transition-normal` | `0.2s ease` | Default state changes. |
| `transition-slow` | `0.3s ease` | Width / layout animations. |
| `transition-instant` | `0s` | Motion-free — brutalist themes snap without animation. |
| `transition-hover` | `0.15s ease` | Quick hover / press feedback. Applied to buttons, chat attach button, sidebar items. |
| `transition-emphasis` | `0.5s ease` | Slow emphasis reveals (shortcut badges, toolbar appear). |
| `ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | |
| `ease-accelerate` | `cubic-bezier(0.4, 0, 1, 1)` | |
| `ease-decelerate` | `cubic-bezier(0, 0, 0.2, 1)` | |

### `border` — edge language

Brutalist themes (Bunker) push these higher for chunky divisions; editorial themes keep hairlines. Applied via `var(--border-thin, 1px)` across ~50 component sites so a single value cascades everywhere.

| Token | Default | Use |
|---|---|---|
| `border-thin` | `1px` | Default divider / card border width. |
| `border-medium` | `2px` | Active-tab underline, emphasis edges, blockquote rule. |
| `border-thick` | `3px` | Strong accent edges on plan / question / attention cards. |

### `icon` — icon sizing scale

Tune density per theme — tight HUDs (Neon Tokyo, Phosphor) shrink; luxury themes (Claudette, Solar) grow.

| Token | Default | Use |
|---|---|---|
| `icon-xs` | `10px` | Tiny indicators / inline dots. |
| `icon-sm` | `14px` | Inline action icons. |
| `icon-md` | `16px` | Toolbar / menu icons. |
| `icon-lg` | `18px` | Prominent icons (command items, avatars). |
| `dot-size` | `8px` | Status / presence dots. |

### `control` — button, input, toggle heights

Drives the overall density feel.

| Token | Default | Use |
|---|---|---|
| `control-height-sm` | `24px` | Compact controls (toggles, chips). |
| `control-height-md` | `32px` | Default button / toolbar row height. |
| `control-height-lg` | `38px` | Prominent inputs, primary buttons. |
| `toggle-track-width` | `36px` | Switch track width. |
| `toggle-track-height` | `20px` | Switch track height. |
| `toggle-thumb-size` | `16px` | Switch thumb diameter. |

### `component` — canonical padding pairs and popover/modal dimensions

| Token | Default | Use |
|---|---|---|
| `control-padding-x` | `12px` | Horizontal padding inside default controls. |
| `control-padding-y` | `6px` | Vertical padding inside default controls. |
| `chip-padding-x` | `6px` | Horizontal padding for chips/pills. |
| `chip-padding-y` | `2px` | Vertical padding for chips/pills. |
| `card-padding` | `16px` | Inner padding for cards, modal bodies. |
| `menu-padding` | `4px` | Outer padding inside popover/menu containers. |
| `menu-item-padding-x` | `14px` | Horizontal padding on menu rows. |
| `menu-item-padding-y` | `8px` | Vertical padding on menu rows. |
| `popover-width` | `520px` | Default popover width (fuzzy finder). |
| `popover-max-height` | `400px` | Max height of a popover list. |
| `modal-width` | `420px` | Default modal shell width. |

### `shape` — structural divergence (bubble vs prose vs card, rail vs block selection, dot vs chevron role labels)

Color-only themes all end up looking like the same app with a different paint job. The `shape` group opens up *structural* divergence — user-message shape, composer chrome, sidebar selection language, role-label glyphs, panel chrome — so a "card" theme and a "prose" theme can look like different products.

These are **raw-value tokens**: they hold CSS values (box-shadow composites, padding shorthand, `content` strings) that component CSS consumes via `var(--token, <default>)`. Defaults reproduce the built-in theme byte-for-byte; override any subset to remix the shape.

#### User message — bubble / prose / card

The default is *prose with an accent rail* — no bounding box, a 2px accent wire on the left.

| Token | Default | Use |
|---|---|---|
| `user-msg-padding` | `8px 14px 8px 16px` | Padding inside the user message block. |
| `user-msg-chrome` | `inset 2px 0 0 rgba(accent, 0.35)` | `box-shadow` composite — the rail / border / ring. |
| `user-msg-bg` | `transparent` | Background fill. Set a tint to turn prose into a bubble. |
| `user-msg-margin-top` | `24px` | Top margin per user turn (after the first). Matches `--turn-gap`. |

**Card treatment recipe:**

```json
"user-msg-chrome": "inset 0 0 0 1px rgba(255,255,255,0.08), 0 2px 8px rgba(0,0,0,0.4)",
"user-msg-bg":     "rgba(var(--accent-primary-rgb), 0.06)",
"user-msg-padding": "12px 16px"
```

**Bubble treatment recipe:**

```json
"user-msg-chrome": "none",
"user-msg-bg":     "rgba(var(--accent-primary-rgb), 0.1)",
"user-msg-padding": "10px 16px"
```

#### Composer — slab vs line

| Token | Default | Use |
|---|---|---|
| `composer-chrome` | `var(--composer-ring)` | `box-shadow` on the composer slab at rest. |
| `composer-chrome-focus` | `var(--composer-ring-focus)` | `box-shadow` on the composer on focus-within. |

Override without touching `--composer-ring` when you want a per-theme chrome shape distinct from the base ring.

**Line treatment recipe** (Bunker-style hairline, no shadow):

```json
"composer-chrome":       "inset 0 -1px 0 rgba(255,255,255,0.1)",
"composer-chrome-focus": "inset 0 -2px 0 var(--accent-primary)"
```

#### Sidebar selection — background vs rail vs card

The default uses an accent *rail* drawn via `::before` plus a subtle `selected-bg` tint.

| Token | Default | Use |
|---|---|---|
| `sidebar-item-bg` | `transparent` | Background of every sidebar item at rest. |
| `sidebar-item-chrome` | `none` | `box-shadow` composite on every item — a card-style theme paints a per-item hairline here. |
| `sidebar-selected-bg` | `var(--selected-bg)` | Background of the selected item. |
| `sidebar-selected-chrome` | `none` | Additional `box-shadow` applied only when selected — heavy ring, card shadow, etc. |

**Card treatment recipe:**

```json
"sidebar-item-chrome":     "inset 0 0 0 1px rgba(255,255,255,0.04)",
"sidebar-selected-chrome": "inset 0 0 0 1px var(--accent-primary), 0 2px 10px rgba(0,0,0,0.4)",
"sidebar-selected-bg":     "rgba(var(--accent-primary-rgb), 0.08)"
```

#### Chat header — dissolve vs slab

| Token | Default | Use |
|---|---|---|
| `chat-header-padding` | `12px 22px` | Header padding. |
| `chat-header-chrome` | `none` | `box-shadow` below the header. Slab themes can drop a divider or shadow here; the default lets the header dissolve into the canvas atmosphere. |

#### Role label — dot vs chevron vs pill

| Token | Default | Use |
|---|---|---|
| `role-label-glyph` | `""` | Raw `content` value for a `::after` prefix. Set `"›"`, `"▌"`, `"//"`, etc. to swap the dot glyph for a chevron / bar / slashes. |
| `role-label-glyph-color` | `var(--accent-primary)` | Color of the custom glyph. |
| `role-label-weight` | `600` | Font-weight of the label. |
| `role-label-transform` | `uppercase` | `text-transform` — set `none` for sentence-case labels. |

> The default `""` glyph renders nothing, so the existing tiny accent dot still wins. Themes that opt into a glyph override the empty string.

#### Panel chrome

| Token | Default | Use |
|---|---|---|
| `panel-header-chrome` | `none` | `box-shadow` applied below panel headers (sidebar repo header, etc.). Hairline / shadow / rim light — your call. |
| `app-bg-gradient` | `none` | Optional additional `background` layer laid ON TOP of `--app-bg` on the outer window shell. Distinct from `--canvas-atmosphere` (which sits behind the chat); this lives at the shell level so themes can add one more depth layer without restating the canvas gradient. |

### `zIndex` — normalized layer order

Keep to this order: sticky < raised < dropdown < overlay < modal. Do not use raw values in component CSS.

| Token | Default | Use |
|---|---|---|
| `z-sticky` | `1` | Sticky in-flow elements. |
| `z-raised` | `10` | Above peers (resize handles, scroll pills). |
| `z-dropdown` | `50` | Menus, disclosures. |
| `z-overlay` | `99` | Modal backdrops. |
| `z-modal` | `100` | Modal / popover content. |

### `layout`

| Token | Default | Use |
|---|---|---|
| `scrollbar-width` | `8px` | Scrollbar gutter size. |
| `scrollbar-thumb-bg` / `scrollbar-thumb-hover-bg` | — | Scrollbar thumb colors. |
| `focus-ring` | `0 0 0 2px rgba(accent, 0.5)` | `box-shadow` applied to `:focus-visible`. |
| `chat-max-width` | `none` | Max width of the chat messages column. `none` is full-bleed; set a length like `820px` for a centered reading column. |
| `turn-gap` | `24px` | Vertical breathing room between consecutive chat turns. Applied as `margin-top` on each user turn after the first. |
| `message-text-max-width` | `none` | Max width applied to each individual message body. `none` lets messages fill the canvas; set a length for a tighter reading measure. |
| `composer-padding-y` | `14px` | Vertical padding inside the chat composer textarea. |
| `composer-min-height` | `44px` | Minimum height of the composer input area. |
| `sidebar-item-padding-y` | `6px` | Vertical padding of each workspace row in the sidebar — controls sidebar density. |
| `sidebar-item-gap` | `2px` | Vertical gap between sibling repo groups in the sidebar list. |
| `canvas-padding-inline` | `32px` | Horizontal padding on the chat canvas (both sides of the messages column). |

> Panel widths (sidebar, right rail, terminal height) are **user preferences** persisted per user, not theme tokens. They're drag-resizable and saved to the app database.

---

## Light themes

Light themes need more than inverted colors — shadows that use solid black look muddy on white. Override elevation tokens with low-opacity gray-blue (e.g. `rgba(27, 31, 36, 0.08)`) and soften the shadow radius.

Declare `"scheme": "light"` in the manifest so Claudette loads the light syntax-highlight CSS and natives match.

---

## Development workflow

- **Live reload**: CSS changes hot-reload in the Tauri dev build. JSON theme edits require a theme re-select (Settings → Appearance → pick the theme again) or app restart.
- **Inspect**: `document.documentElement` style panel in devtools shows every active `--token`.
- **Schema validation**: point your editor at `theme.schema.json` (VS Code: `json.schemas` setting, or set `$schema` at the top of your theme file as in the skeleton).

## Back-compat: legacy flat shape

Older themes used a flat top-level structure:

```json
{
  "id": "old-theme",
  "name": "Old Theme",
  "colors": {
    "accent-primary": "#f00",
    "app-bg": "#111"
  }
}
```

This still works. `applyTheme()` detects the shape and flattens the `colors` map into CSS variables. New themes should prefer the structured `manifest` + `tokens` shape for schema validation and group readability.

---

## Extending the token set

Need to theme something that isn't currently a variable? Two-step patch:

1. Replace the hardcoded value in component CSS with `var(--your-token, fallback)`.
2. Add the token name to:
   - `theme.css` `:root` (default value)
   - `THEMEABLE_TOKENS` in `utils/theme.ts` (allowlist)
   - `theme.schema.json` (optional — for editor autocomplete)
   - This doc.

Every token that exists should be documented here, visible in the schema, and overridable in a theme file. That's the contract.
