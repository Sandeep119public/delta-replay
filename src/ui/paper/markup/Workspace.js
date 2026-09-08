export const workspaceMarkup = () => `<div class="main-layout">
  <main class="main" aria-label="Market chart workspace">
    <div class="chart-stage">
      <div id="chart-container" class="chart-container"></div>
      <div id="chart-floating-bar" class="chart-position-chip hidden" aria-live="polite">
        <span id="chart-pos-icon" aria-hidden="true"></span>
        <span id="chart-pos-symbol"></span>
        <span id="chart-pos-side-text"></span>
        <span id="chart-pos-qty"></span>
        <span class="chip-separator">•</span>
        <span id="chart-pos-entry"></span>
        <span id="chart-pos-mark"></span>
        <span id="chart-pos-pnl"></span>
        <button id="btn-chart-close" type="button" aria-label="Close position">×</button>
      </div>
      <div id="chart-toast" class="chart-toast hidden" role="status" aria-live="polite"></div>
    </div>
  </main>

  <aside id="trading-panel" class="trading-section" aria-label="Paper trading panel">
    <div class="panel-heading">
      <div><span class="eyebrow">PAPER ACCOUNT</span><h2>Trading desk</h2></div>
      <span class="paper-badge">SIM</span>
    </div>
    <div class="trading-top-summary" aria-label="Account snapshot">
      <div class="summary-main"><span class="summary-label">Equity</span><strong id="acct-equity">—</strong></div>
      <div class="summary-side"><span class="summary-label">Unrealized P&amp;L</span><strong id="acct-unrealized">—</strong></div>
      <span id="trading-error" class="trading-error hidden" role="alert"></span>
    </div>

    <div class="trading-tab-nav" role="tablist" aria-label="Trading views">
      <button class="panel-tab-btn active" type="button" role="tab" aria-selected="true" aria-controls="tab-view-trade" data-tab="trade">Trade</button>
      <button class="panel-tab-btn" type="button" role="tab" aria-selected="false" aria-controls="tab-view-account" data-tab="account">Account</button>
    </div>

    <div id="tab-view-trade" class="tab-panel active" role="tabpanel" aria-label="Trade">
      <section id="order-ticket" class="order-ticket is-flat" aria-label="Order ticket">
        <div class="ticket-header"><div><span class="eyebrow">ORDER TICKET</span><p id="ticket-state-hint" class="ticket-state-hint">FLAT • Pick a size</p></div><span id="pos-state-pill" class="pos-state-pill is-flat">FLAT</span></div>
        <div class="ticket-quick-start"><span class="quick-start-label">Quick order</span><span class="quick-start-hint">Set size, then choose a side</span></div><div class="ticket-field-grid">
          <label class="field">Order type<select id="order-type" aria-label="Order type"><option value="MARKET">Market</option><option value="LIMIT">Limit</option><option value="STOP_MARKET">Stop market</option></select></label>
          <label class="field">Quantity<input id="trade-qty" inputmode="decimal" autocomplete="off" placeholder="0.00" aria-describedby="qty-notional"><span id="qty-notional" class="field-hint">≈ $0</span></label>
          <label id="limit-price-row" class="field hidden">Limit price<input id="limit-price" inputmode="decimal" placeholder="0.00"></label>
          <label id="stop-price-row" class="field hidden">Stop price<input id="stop-price" inputmode="decimal" placeholder="0.00"></label>
        </div>
        <button id="advanced-toggle" class="advanced-toggle" type="button" aria-expanded="false">Advanced order controls <span aria-hidden="true">＋</span></button>
        <div class="side-actions" aria-label="Place order">
          <button id="btn-buy" class="order-action buy btn-buy-main" type="button"><span>Buy / Long</span><kbd>1</kbd></button>
          <button id="btn-sell" class="order-action sell btn-sell-main" type="button"><span>Sell / Short</span><kbd>2</kbd></button>
        </div>
        <details class="risk-details"><summary>Position & risk management</summary><div class="position-card">
          <div class="position-card-head"><div><span class="eyebrow">OPEN POSITION</span><strong id="pos-symbol">No position</strong></div><span id="pos-side" class="position-side">—</span></div>
          <div class="pos-compact-grid"><div><span>Size</span><strong id="pos-qty">—</strong></div><div><span>Entry</span><strong id="pos-entry">—</strong></div><div><span>Mark</span><strong id="pos-current">—</strong></div><div><span>P&amp;L</span><strong id="pos-pnl">—</strong></div></div>
          <div class="risk-grid"><label class="field">Stop loss<input id="sl-price" inputmode="decimal" placeholder="Optional"></label><label class="field">Take profit<input id="tp-price" inputmode="decimal" placeholder="Optional"></label></div>
          <div class="risk-actions"><button id="btn-set-risk" class="btn btn-secondary" type="button">Set risk</button><button id="btn-clear-risk" class="btn btn-ghost" type="button">Clear</button></div>
          <div class="current-risk"><span>SL <strong id="pos-sl">—</strong></span><span>TP <strong id="pos-tp">—</strong></span></div>
          <div id="ticket-flatten-summary" class="flatten-summary hidden"><div><span>Entry</span><strong id="flatten-entry">—</strong></div><div><span>Mark</span><strong id="flatten-mark">—</strong></div><div><span>P&amp;L</span><strong id="flatten-pnl" class="num">—</strong></div></div>
          <button id="btn-close" class="flatten-button" type="button">Close position</button>
        </div></details>
      </section>
      <section class="activity-card" aria-label="Order activity">
        <div class="section-heading"><span>Pending orders</span><span class="section-count">LIVE</span></div>
        <div id="pending-orders-list" class="activity-list"><span class="empty-hint">No pending orders</span></div>
        <div class="section-heading section-heading-divider"><span>Recent fills</span><span class="section-count">LATEST</span></div>
        <div id="trades-list" class="activity-list"><span class="empty-hint">No fills yet</span></div>
        <div id="ticket-fills-list" class="ticket-fills-list"></div>
      </section>
    </div>

    <div id="tab-view-account" class="tab-panel" role="tabpanel" aria-label="Account">
      <section class="account-card"><div class="account-stat"><span>Cash balance</span><strong id="acct-balance">—</strong></div><div class="account-stat"><span>Realized P&amp;L</span><strong id="acct-realized">—</strong></div><div class="account-stat"><span>Fees paid</span><strong id="acct-fees">—</strong></div></section>
      <button id="btn-reset-acct" class="btn btn-danger" type="button">Reset paper account</button>
    </div>
  </aside>
</div>`;
