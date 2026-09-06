export const THEMES = {
  DARK: 'dark',
  PAPER: 'paper',
  LIGHT: 'light',
  MIDNIGHT: 'midnight',
  COLORBLIND: 'colorblind',
};

export const THEME_NAMES = {
  [THEMES.DARK]: 'Dark Pro',
  [THEMES.PAPER]: 'Paper',
  [THEMES.LIGHT]: 'Clean Light',
  [THEMES.MIDNIGHT]: 'Midnight',
  [THEMES.COLORBLIND]: 'Colorblind Safe',
};

/**
 * Heavy per-theme font payloads. Only Obsidian/Light/Midnight fonts (Inter,
 * JetBrains Mono) load globally via index.html; paper-only families are
 * injected on demand right before the paper transition so default-theme
 * users skip the extra download entirely.
 */
export const THEME_FONT_URLS = {
  [THEMES.PAPER]:
    'https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700;800;900&family=Ma+Shan+Zheng&family=Shippori+Mincho:wght@400;500;600;700;800&family=Noto+Serif+SC:wght@400;600;700&display=swap',
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

  /**
   * Injects the theme's font stylesheet on first use (no-op when the link
   * already exists or the theme needs no extra fonts). Called right before
   * the data-theme transition so glyphs arrive with the palette swap.
   */
  _ensureThemeFonts(theme) {
    try {
      const url = THEME_FONT_URLS[theme];
      if (!url) return false;
      if (typeof document === 'undefined') return false;
      const selector = `link[data-theme-fonts="${theme}"]`;
      if (typeof document.querySelector === 'function' && document.querySelector(selector)) return true;
      if (typeof document.createElement !== 'function') return false;
      const link = document.createElement('link');
      if (!link || typeof link.setAttribute !== 'function') return false;
      link.setAttribute('rel', 'stylesheet');
      link.setAttribute('href', url);
      link.setAttribute('data-theme-fonts', theme);
      const head = document.head || (typeof document.getElementsByTagName === 'function' ? document.getElementsByTagName('head')[0] : null) || document.documentElement;
      if (head && typeof head.appendChild === 'function') {
        head.appendChild(link);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  applyTheme(theme, save = true) {
    if (!theme || !Object.values(THEMES).includes(theme)) {
      theme = this.defaultTheme;
    }
    this.currentTheme = theme;
    this._ensureThemeFonts(theme);

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
