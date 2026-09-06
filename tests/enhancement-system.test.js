import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Router } from '../src/router/Router.js';
import { Persona } from '../src/personality/Persona.js';
import { PaperTradingEngine } from '../src/trading/PaperTradingEngine.js';

describe('Enhancement System: Router, Persona & Statistics', () => {
  describe('Router', () => {
    let router;
    let originalWindow;
    let originalDocument;
    let mockPages;
    let mockNavLinks;
    let listeners;

    beforeEach(() => {
      originalWindow = globalThis.window;
      originalDocument = globalThis.document;

      listeners = {};
      mockPages = new Map();
      mockNavLinks = [];

      const createMockEl = (id, dataset = {}, isPage = true) => {
        const classes = new Set(isPage ? ['page'] : ['nav-link']);
        return {
          id,
          dataset,
          style: { display: '' },
          classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            toggle: (c, force) => {
              if (force === undefined) {
                if (classes.has(c)) classes.delete(c);
                else classes.add(c);
              } else if (force) classes.add(c);
              else classes.delete(c);
            },
            contains: (c) => classes.has(c),
          }
        };
      };

      const replayPage = createMockEl('page-replay', { page: 'replay' }, true);
      const dashPage = createMockEl('page-dashboard', { page: 'dashboard' }, true);
      const stratPage = createMockEl('page-strategies', { page: 'strategies' }, true);
      mockPages.set('page-replay', replayPage);
      mockPages.set('page-dashboard', dashPage);
      mockPages.set('page-strategies', stratPage);

      const replayNav = createMockEl('nav-replay', { page: 'replay' }, false);
      const dashNav = createMockEl('nav-dashboard', { page: 'dashboard' }, false);
      const stratNav = createMockEl('nav-strategies', { page: 'strategies' }, false);
      mockNavLinks.push(replayNav, dashNav, stratNav);

      globalThis.window = {
        location: { hash: '' },
        addEventListener: (evt, fn) => {
          if (!listeners[evt]) listeners[evt] = [];
          listeners[evt].push(fn);
        },
        removeEventListener: (evt, fn) => {
          if (listeners[evt]) listeners[evt] = listeners[evt].filter(f => f !== fn);
        },
        dispatchEvent: (evt) => {
          const arr = listeners[evt.type] || [];
          arr.forEach(fn => fn(evt));
        },
        CustomEvent: class {
          constructor(type, init = {}) {
            this.type = type;
            this.detail = init.detail;
          }
        }
      };

      globalThis.document = {
        getElementById: (id) => mockPages.get(id) || null,
        querySelectorAll: (selector) => {
          if (selector.includes('.page')) {
            return Array.from(mockPages.values());
          }
          if (selector.includes('.nav-link')) {
            return mockNavLinks;
          }
          return [];
        }
      };

      router = new Router();
    });

    afterEach(() => {
      globalThis.window = originalWindow;
      globalThis.document = originalDocument;
    });

    it('registers pages and navigates to target page', () => {
      router.register('replay', null);
      router.register('dashboard', null);
      router.register('strategies', null);

      let eventReceived = null;
      const listener = (e) => { eventReceived = e.detail.page; };
      globalThis.window.addEventListener('pagechange', listener);

      router.navigate('dashboard');

      expect(router.currentPage).toBe('dashboard');
      expect(globalThis.window.location.hash).toBe('dashboard');
      expect(eventReceived).toBe('dashboard');

      const replayEl = mockPages.get('page-replay');
      const dashEl = mockPages.get('page-dashboard');

      expect(replayEl.classList.contains('active')).toBe(false);
      expect(replayEl.style.display).toBe('none');

      expect(dashEl.classList.contains('active')).toBe(true);
      expect(dashEl.style.display).toBe('');

      // Check nav link active state
      const dashNav = mockNavLinks.find(l => l.dataset.page === 'dashboard');
      const replayNav = mockNavLinks.find(l => l.dataset.page === 'replay');
      expect(dashNav.classList.contains('active')).toBe(true);
      expect(replayNav.classList.contains('active')).toBe(false);

      globalThis.window.removeEventListener('pagechange', listener);
    });

    it('does not hide .nav-link when switching pages', () => {
      router.register('replay', null);
      router.register('dashboard', null);
      router.navigate('dashboard');

      mockNavLinks.forEach(link => {
        expect(link.style.display).not.toBe('none');
      });
    });
  });

  describe('Persona', () => {
    it('initializes with mood, quotes, and greeting', () => {
      const persona = new Persona();
      expect(persona.name).toBe('Delta');
      expect(['energetic', 'focused', 'reflective', 'vigilant']).toContain(persona.mood);
      expect(typeof persona.greeting).toBe('string');
      expect(persona.greeting.length).toBeGreaterThan(5);
    });

    it('reacts to winning and losing trades', () => {
      const persona = new Persona();
      const winReaction = persona.getTradeReaction('win');
      const lossReaction = persona.getTradeReaction('loss');
      expect(typeof winReaction).toBe('string');
      expect(typeof lossReaction).toBe('string');
      expect(winReaction.length).toBeGreaterThan(5);
      expect(lossReaction.length).toBeGreaterThan(5);
    });

    it('provides market commentary based on price movement', () => {
      const persona = new Persona();
      const bullish = persona.getMarketComment('BTCUSDT', 50000, 2.5);
      const bearish = persona.getMarketComment('BTCUSDT', 50000, -2.5);
      const neutral = persona.getMarketComment('BTCUSDT', 50000, 0.2);

      expect(bullish).toContain('BTCUSDT');
      expect(bearish).toContain('BTCUSDT');
      expect(neutral).toContain('BTCUSDT');
    });
  });

  describe('PaperTradingEngine Statistics & Equity History', () => {
    it('returns statistics and initial equity history', () => {
      const engine = new PaperTradingEngine({ startingBalance: 15000 });
      const stats = engine.getStatistics();
      expect(stats.equity).toBe(15000);
      expect(stats.totalTrades).toBe(0);
      expect(stats.winRate).toBe(0);
      expect(stats.netPnl).toBe(0);

      const history = engine.getEquityHistory();
      expect(Array.isArray(history)).toBe(true);
      expect(history).toEqual([15000]);
    });

    it('resets equity history on account reset and balance change', () => {
      const engine = new PaperTradingEngine({ startingBalance: 10000 });
      engine._equityHistory = [10000, 10500, 11000];

      engine.resetAccount();
      expect(engine.getEquityHistory()).toEqual([10000]);

      engine.setStartingBalance(25000);
      expect(engine.getEquityHistory()).toEqual([25000]);
    });
  });
});
