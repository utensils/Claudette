import type { ThemeDefinition } from "../../types/theme";
import defaultTheme from "./default.json";
import claudetteTheme from "./claudette.json";
import linearTheme from "./linear.json";
import velvetTheme from "./velvet.json";
import roseTheme from "./rose.json";
import neonTokyoTheme from "./neon-tokyo.json";
import solarTheme from "./solar.json";
import gruvboxTheme from "./gruvbox.json";
import bunkerTheme from "./bunker.json";
import greenhouseTheme from "./greenhouse.json";
import uplink1984Theme from "./uplink-1984.json";
import phosphorUplinkTheme from "./phosphor-uplink.json";

export const BUILTIN_THEMES: ThemeDefinition[] = [
  defaultTheme as ThemeDefinition,
  claudetteTheme as ThemeDefinition,
  linearTheme as ThemeDefinition,
  velvetTheme as ThemeDefinition,
  roseTheme as ThemeDefinition,
  neonTokyoTheme as ThemeDefinition,
  solarTheme as ThemeDefinition,
  gruvboxTheme as ThemeDefinition,
  bunkerTheme as ThemeDefinition,
  greenhouseTheme as ThemeDefinition,
  uplink1984Theme as ThemeDefinition,
  phosphorUplinkTheme as ThemeDefinition,
];

export const DEFAULT_THEME_ID = "default";
