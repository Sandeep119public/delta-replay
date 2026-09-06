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
    this._bindPills();
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

  _getPills() {
    try {
      if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return [];
      const pills = document.querySelectorAll('.theme-pill');
      if (!pills) return [];
      return Array.from(pills);
    } catch {
      return [];
    }
  }

  _bindPills() {
    const pills = this._getPills();
    if (!pills.length) return;
    pills.forEach((pill) => {
      if (!pill || typeof pill.addEventListener !== 'function') return;
      pill.addEventListener('click', () => {
        const theme = pill.getAttribute ? pill.getAttribute('data-theme') : pill.dataset?.theme;
        if (theme) this.applyTheme(theme, true);
      });
      // Roving tabindex arrow-key navigation for the radiogroup
      pill.addEventListener('keydown', (event) => {
        if (!event || (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End')) return;
        if (typeof event.preventDefault === 'function') event.preventDefault();
        const list = this._getPills();
        if (!list.length) return;
        const current = list.indexOf(pill);
        let next = current;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % list.length;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + list.length) % list.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = list.length - 1;
        const target = list[next];
        if (!target) return;
        if (typeof target.focus === 'function') target.focus();
        const theme = target.getAttribute ? target.getAttribute('data-theme') : target.dataset?.theme;
        if (theme) this.applyTheme(theme, true);
      });
    });
  }

  _syncPills(theme) {
    const pills = this._getPills();
    if (!pills.length) return;
    pills.forEach((pill) => {
      if (!pill) return;
      const name = pill.getAttribute ? pill.getAttribute('data-theme') : pill.dataset?.theme;
      const isActive = name === theme;
      if (pill.classList && typeof pill.classList.toggle === 'function') {
        pill.classList.toggle('active', isActive);
      }
      if (typeof pill.setAttribute === 'function') {
        pill.setAttribute('aria-checked', isActive ? 'true' : 'false');
        // Roving tabindex: only the active pill is tabbable
        pill.setAttribute('tabindex', isActive ? '0' : '-1');
      }
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

    this._syncPills(theme);

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
