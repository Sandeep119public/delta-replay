export class StrategiesPage {
  constructor() {
    this.el = document.getElementById('page-strategies');
    this.currentFilter = 'all';
    this.searchQuery = '';
    this.strategies = [
      {
        id: 'golden-cross',
        name: 'Golden Cross',
        description: 'Buy when 50 SMA crosses above 200 SMA on daily or 4h timeframe',
        winRate: 58,
        avgReturn: 2.3,
        trades: 42,
        status: 'active'
      },
      {
        id: 'rsi-reversal',
        name: 'RSI Reversal',
        description: 'Mean reversion: buy at RSI < 30 with bullish divergence, sell at RSI > 70',
        winRate: 62,
        avgReturn: 1.8,
        trades: 67,
        status: 'active'
      },
      {
        id: 'breakout',
        name: 'Breakout Hunter',
        description: 'Enter on 20-period Donchian high breakout confirmed with elevated volume',
        winRate: 45,
        avgReturn: 3.1,
        trades: 28,
        status: 'paused'
      },
      {
        id: 'mean-reversion',
        name: 'Mean Reversion VWAP',
        description: 'Fade extended price action beyond 2 standard deviations from rolling VWAP',
        winRate: 71,
        avgReturn: 1.2,
        trades: 94,
        status: 'active'
      },
      {
        id: 'macd-trend',
        name: 'MACD Momentum Trend',
        description: 'Ride momentum impulses when MACD line crosses signal with histogram expansion',
        winRate: 53,
        avgReturn: 2.7,
        trades: 51,
        status: 'active'
      }
    ];
  }

  render() {
    if (!this.el) {
      this.el = document.getElementById('page-strategies');
      if (!this.el) return;
    }

    const filtered = this.strategies.filter(s => {
      const matchFilter = this.currentFilter === 'all' || s.status === this.currentFilter;
      const matchSearch = !this.searchQuery || 
        s.name.toLowerCase().includes(this.searchQuery.toLowerCase()) || 
        s.description.toLowerCase().includes(this.searchQuery.toLowerCase());
      return matchFilter && matchSearch;
    });

    this.el.innerHTML = `
      <div class="page-container">
        <div class="page-header">
          <h1 class="page-title">Strategy Library</h1>
          <p class="page-subtitle">Curated algorithms, trend followers, and paper backtesting playbooks</p>
        </div>
        
        <div class="strategies-toolbar">
          <div class="search-box">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
            </svg>
            <input type="text" placeholder="Search strategies..." id="strategy-search" value="${this.searchQuery}" />
          </div>
          <div class="filter-chips">
            <button class="filter-chip ${this.currentFilter === 'all' ? 'active' : ''}" data-filter="all">All</button>
            <button class="filter-chip ${this.currentFilter === 'active' ? 'active' : ''}" data-filter="active">Active</button>
            <button class="filter-chip ${this.currentFilter === 'paused' ? 'active' : ''}" data-filter="paused">Paused</button>
          </div>
        </div>
        
        <div class="strategies-grid stagger-in">
          ${filtered.length === 0
            ? '<div class="empty-state">No matching strategies found.</div>'
            : filtered.map(s => this.renderStrategyCard(s)).join('')
          }
        </div>
        
        <div class="strategy-builder-section">
          <h2 class="section-title">Create Custom Strategy</h2>
          <div class="builder-card">
            <p class="builder-intro">Build your own algorithmic edge using our visual rule-builder or code-based indicator framework.</p>
            <div class="builder-actions">
              <button class="btn btn-primary" id="btn-visual-builder">Visual Rule Builder</button>
              <button class="btn btn-secondary" id="btn-code-editor">Code Framework Editor</button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.attachEventListeners();
  }

  renderStrategyCard(strategy) {
    return `
      <div class="strategy-card" data-status="${strategy.status}">
        <div class="strategy-card-header">
          <div class="strategy-status-badge ${strategy.status}">
            <span class="status-dot"></span>
            ${strategy.status}
          </div>
          <button class="strategy-menu-btn" title="Strategy Options">⋮</button>
        </div>
        
        <h3 class="strategy-name">${strategy.name}</h3>
        <p class="strategy-desc">${strategy.description}</p>
        
        <div class="strategy-metrics">
          <div class="metric">
            <span class="metric-value">${strategy.winRate}%</span>
            <span class="metric-label">Win Rate</span>
          </div>
          <div class="metric">
            <span class="metric-value">+${strategy.avgReturn}%</span>
            <span class="metric-label">Avg Return</span>
          </div>
          <div class="metric">
            <span class="metric-value">${strategy.trades}</span>
            <span class="metric-label">Trades</span>
          </div>
        </div>
        
        <div class="strategy-actions">
          <button class="btn btn-sm btn-primary" data-action="backtest" data-id="${strategy.id}">Backtest</button>
          <button class="btn btn-sm btn-secondary" data-action="configure" data-id="${strategy.id}">Configure</button>
        </div>
      </div>
    `;
  }

  attachEventListeners() {
    const searchInput = this.el.querySelector('#strategy-search');
    searchInput?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value;
      this.render();
      // Restore focus to input after re-render
      const newSearch = this.el.querySelector('#strategy-search');
      if (newSearch) {
        newSearch.focus();
        newSearch.setSelectionRange(this.searchQuery.length, this.searchQuery.length);
      }
    });

    this.el.querySelectorAll('.filter-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        this.currentFilter = btn.dataset.filter || 'all';
        this.render();
      });
    });

    this.el.querySelectorAll('[data-action="backtest"]').forEach(btn => {
      btn.addEventListener('click', () => {
        window.location.hash = 'replay';
      });
    });
  }
}
