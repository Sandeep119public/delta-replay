export const THEMES = {
  DARK: 'dark',
  PAPER: 'paper',
  LIGHT: 'light',
  MIDNIGHT: 'midnight',
};

export const THEME_NAMES = {
  [THEMES.DARK]: 'Dark Pro',
  [THEMES.PAPER]: 'Paper Manuscript',
  [THEMES.LIGHT]: 'Clean Light',
  [THEMES.MIDNIGHT]: 'Midnight OLED',
};

/**
 * ThemeManager handles switching and persisting UI color themes.
 * Coordinates document root data-theme attribute, localStorage,
 * and chart color synchronization.
 */
export class ThemeManager {
  constructor({
    selectEl = typeof document !== 'undefined' ? document.getElementById('theme-select') : null,
    defaultTheme = THEMES.DARK,
    storageKey = 'delta_replay_theme',
    onThemeChange = null,
  } = {}) {
    this.selectEl = selectEl;
    this.defaultTheme = defaultTheme;
    this.storageKey = storageKey;
    this.onThemeChange = onThemeChange;
    this.currentTheme = this._loadSavedTheme() || this.defaultTheme;

    this._bindSelect();
    this.applyTheme(this.currentTheme, false);
  }

  _loadSavedTheme() {
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem(this.storageKey);
        if (saved && Object.values(THEMES).includes(saved)) {
          return saved;
        }
      }
    } catch {}
    return null;
  }

  _saveTheme(theme) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, theme);
      }
    } catch {}
  }

  _bindSelect() {
    if (!this.selectEl) return;
    this.selectEl.value = this.currentTheme;
    this.selectEl.addEventListener('change', () => {
      const selected = this.selectEl.value;
      this.applyTheme(selected, true);
    });
  }

  getTheme() {
    return this.currentTheme;
  }

  applyTheme(theme, save = true) {
    if (!theme || !Object.values(THEMES).includes(theme)) {
      theme = this.defaultTheme;
    }
    this.currentTheme = theme;

    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
      if (document.body) {
        document.body.setAttribute('data-theme', theme);
      }
    }

    if (this.selectEl && this.selectEl.value !== theme) {
      this.selectEl.value = theme;
    }

    if (save) {
      this._saveTheme(theme);
    }

    if (typeof this.onThemeChange === 'function') {
      try {
        this.onThemeChange(theme);
      } catch (err) {
        console.warn('[ThemeManager] onThemeChange error:', err);
      }
    }

    return theme;
  }
}
