export class DashboardPage {
  constructor(tradingEngine) {
    this.tradingEngine = tradingEngine;
    this.el = document.getElementById('page-dashboard');
  }

  render() {
    if (!this.el) {
      this.el = document.getElementById('page-dashboard');
      if (!this.el) return;
    }

    const stats = typeof this.tradingEngine?.getStatistics === 'function'
      ? this.tradingEngine.getStatistics()
      : (this.tradingEngine?.getPerformanceStats?.() || {});
    
    const equity = stats.equity ?? this.tradingEngine?.account?.equity ?? 10000;
    const returnPct = stats.returnPct ?? stats.netReturn ?? 0;
    const totalTrades = stats.totalTrades ?? 0;
    const wins = stats.wins ?? stats.winningTrades ?? 0;
    const losses = stats.losses ?? stats.losingTrades ?? 0;
    const winRate = stats.winRate ?? (totalTrades > 0 ? (wins / totalTrades) * 100 : 0);
    const netPnl = stats.netPnl ?? this.tradingEngine?.account?.realizedPnL ?? 0;

    this.el.innerHTML = `
      <div class="page-container">
        <div class="page-header">
          <h1 class="page-title">Trading Dashboard</h1>
          <p class="page-subtitle">Your real-time performance and portfolio analytics</p>
        </div>
        
        <div class="dashboard-grid stagger-in">
          <div class="dash-card equity-card">
            <div class="dash-card-icon">💰</div>
            <div class="dash-card-content">
              <span class="dash-label">Total Equity</span>
              <span class="dash-value">$${Number(equity).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              <span class="dash-change ${returnPct >= 0 ? 'positive' : 'negative'}">
                ${returnPct >= 0 ? '+' : ''}${Number(returnPct).toFixed(2)}%
              </span>
            </div>
          </div>
          
          <div class="dash-card trades-card">
            <div class="dash-card-icon">📊</div>
            <div class="dash-card-content">
              <span class="dash-label">Total Trades</span>
              <span class="dash-value">${totalTrades}</span>
              <span class="dash-detail">${wins}W / ${losses}L</span>
            </div>
          </div>
          
          <div class="dash-card winrate-card">
            <div class="dash-card-icon">🎯</div>
            <div class="dash-card-content">
              <span class="dash-label">Win Rate</span>
              <span class="dash-value">${Number(winRate).toFixed(1)}%</span>
              <div class="winrate-bar">
                <div class="winrate-fill" style="width: ${Math.min(100, Math.max(0, winRate))}%"></div>
              </div>
            </div>
          </div>
          
          <div class="dash-card pnl-card">
            <div class="dash-card-icon">📈</div>
            <div class="dash-card-content">
              <span class="dash-label">Net Realized P&L</span>
              <span class="dash-value ${netPnl >= 0 ? 'positive' : 'negative'}">
                ${netPnl >= 0 ? '+' : '-'}$${Math.abs(Number(netPnl)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span class="dash-detail">All closed positions</span>
            </div>
          </div>
        </div>
        
        <div class="dashboard-section">
          <h2 class="section-title">Equity Curve</h2>
          <div class="equity-chart-container">
            <canvas id="equity-chart" width="800" height="220"></canvas>
          </div>
        </div>
        
        <div class="dashboard-section">
          <h2 class="section-title">Recent Activity</h2>
          <div class="recent-trades-list">
            ${this.renderRecentTrades()}
          </div>
        </div>
      </div>
    `;
    
    this.attachEventListeners();
    this.renderEquityChart();
  }

  renderRecentTrades() {
    const trades = this.tradingEngine?.getTradeHistory?.() || [];
    const recent = trades.slice(-8).reverse();
    
    if (recent.length === 0) {
      return '<div class="empty-state">No trades recorded yet. Start a replay and place your first paper trade!</div>';
    }
    
    return recent.map(trade => {
      const pnl = trade.netPnL ?? trade.realizedPnL ?? trade.pnl ?? 0;
      const isPos = pnl >= 0;
      const side = (trade.side || 'BUY').toLowerCase();
      return `
        <div class="recent-trade-item ${side}">
          <div class="trade-info">
            <span class="trade-side">${(trade.side || 'TRADE').toUpperCase()}</span>
            <span class="trade-symbol">${trade.symbol || 'MARKET'}</span>
            <span class="trade-qty">Qty: ${trade.quantity ?? trade.qty ?? '—'}</span>
            <span class="trade-qty">Exit: $${trade.exitPrice != null ? Number(trade.exitPrice).toFixed(2) : '—'}</span>
          </div>
          <div class="trade-result">
            <span class="trade-pnl ${isPos ? 'positive' : 'negative'}">
              ${isPos ? '+' : ''}$${Number(pnl).toFixed(2)}
            </span>
          </div>
        </div>
      `;
    }).join('');
  }

  renderEquityChart() {
    const canvas = document.getElementById('equity-chart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const history = this.tradingEngine?.getEquityHistory?.() || [];
    
    if (history.length < 2) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#8a93a6';
      ctx.font = '14px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Complete trades in replay to generate your equity curve', canvas.width / 2, canvas.height / 2);
      return;
    }
    
    const padding = 40;
    const width = canvas.width - padding * 2;
    const height = canvas.height - padding * 2;
    
    const min = Math.min(...history);
    const max = Math.max(...history);
    const range = (max - min) === 0 ? 1 : (max - min);
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw background grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padding + (height / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(canvas.width - padding, y);
      ctx.stroke();
    }
    
    // Draw line
    ctx.beginPath();
    ctx.strokeStyle = '#3B82F6';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    
    history.forEach((val, i) => {
      const x = padding + (width / (history.length - 1)) * i;
      const y = padding + height - ((val - min) / range) * height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    
    ctx.stroke();
    
    // Fill gradient area below line
    ctx.lineTo(padding + width, padding + height);
    ctx.lineTo(padding, padding + height);
    ctx.closePath();
    
    const gradient = ctx.createLinearGradient(0, padding, 0, padding + height);
    gradient.addColorStop(0, 'rgba(59, 130, 246, 0.35)');
    gradient.addColorStop(1, 'rgba(59, 130, 246, 0.0)');
    ctx.fillStyle = gradient;
    ctx.fill();

    // Draw min / max annotations
    ctx.fillStyle = '#8a93a6';
    ctx.font = '11px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`$${max.toFixed(2)}`, canvas.width - padding - 4, padding + 12);
    ctx.fillText(`$${min.toFixed(2)}`, canvas.width - padding - 4, padding + height);
  }

  attachEventListeners() {
    // Interactive actions if any
  }
}
