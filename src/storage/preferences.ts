export interface Preferences {
  theme: 'system' | 'dark' | 'light';
  font: 'sans' | 'serif' | 'mono';
  fontSize: number;
  lineHeight: number;
  wrap: boolean;
  spellcheck: boolean;
  tabWidth: number;
  autosave: number;
  assets: string;
  hidden: boolean;
  sidebarWidth: number;
  math: boolean;
  mermaid: boolean;
  wiki: boolean;
  callouts: boolean;
  density: 'comfortable' | 'compact';
  typewriter: boolean;
}
export const defaults: Preferences = {
  theme: 'system',
  font: 'sans',
  fontSize: 16,
  lineHeight: 1.8,
  wrap: true,
  spellcheck: false,
  tabWidth: 2,
  autosave: 700,
  assets: 'assets',
  hidden: false,
  sidebarWidth: 244,
  math: true,
  mermaid: true,
  wiki: true,
  callouts: true,
  density: 'comfortable',
  typewriter: false,
};
