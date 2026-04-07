export interface ThemeDefinition {
  id: string;
  name: string;
  author?: string;
  description?: string;
  colors: Record<string, string>;
}
