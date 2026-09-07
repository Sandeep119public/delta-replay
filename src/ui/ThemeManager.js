export const THEMES = Object.freeze({ PAPER: 'paper' });
export const THEME_NAMES = Object.freeze({ [THEMES.PAPER]: 'Paper' });

/**
 * Delta Replay is intentionally a single-theme application.
 * This class remains as a small compatibility boundary for the chart and UI
 * composition layer, but theme switching and persistence are deliberately gone.
 */
export class ThemeManager {
  constructor({ onThemeChange = null } = {}) {
    this.currentTheme = THEMES.PAPER;
    this.onThemeChange = onThemeChange;
    this.applyTheme(THEMES.PAPER, false);
  }

  getTheme() { return THEMES.PAPER; }

  applyTheme(_theme = THEMES.PAPER, _save = false) {
    this.currentTheme = THEMES.PAPER;
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', THEMES.PAPER);
      document.body?.setAttribute('data-theme', THEMES.PAPER);
    }
    try { this.onThemeChange?.(THEMES.PAPER); } catch {}
    return THEMES.PAPER;
  }

  destroy() { this.onThemeChange = null; }
}
