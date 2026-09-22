export const terminalMarkup = () => `
  <aside id="app-sidebar" class="app-sidebar" aria-label="Application navigation">
    <div class="app-brand"><span class="app-brand-mark" aria-hidden="true">Δ</span><div><strong>DELTA REPLAY</strong><span>MARKET RESEARCH WORKSTATION</span></div></div>
    <nav class="app-nav" aria-label="Main navigation">
      <a class="nav-link" data-page="dashboard" href="#dashboard">Overview</a>
      <a class="nav-link" data-page="replay" href="#replay">Replay</a>
      <div class="nav-section-label">Data</div>
      <a class="nav-link" data-page="downloads" href="#downloads">Downloads</a>
      <a class="nav-link" data-page="datasets" href="#datasets">Datasets</a>
      <a class="nav-link" data-page="validation" href="#validation">Validation</a>
      <a class="nav-link" data-page="storage" href="#storage">Storage</a>
      <div class="nav-section-label">Research</div>
      <a class="nav-link" data-page="experiments" href="#experiments">Experiments</a>
      <a class="nav-link" data-page="strategies" href="#strategies">Strategies</a>
      <a class="nav-link" data-page="journal" href="#journal">Journal</a>
      <div class="nav-section-label">System</div>
      <a class="nav-link" data-page="jobs" href="#jobs">Jobs</a>
      <a class="nav-link" data-page="system" href="#system">System</a>
    </nav>
    <div class="app-sidebar-footer"><span class="status-dot"></span> Browser research environment</div>
  </aside>
  <button id="mobile-nav-toggle" class="mobile-nav-toggle" type="button" aria-label="Open navigation" aria-controls="app-sidebar" aria-expanded="false">☰</button>
  <div id="mobile-nav-scrim" class="mobile-nav-scrim" aria-hidden="true"></div>
  <main id="page-host" class="page-host">
    <section id="page-dashboard" class="app-page page" data-page="dashboard" hidden></section>
    <section id="page-downloads" class="app-page page" data-page="downloads" hidden></section>
    <section id="page-datasets" class="app-page page" data-page="datasets" hidden></section>
    <section id="page-validation" class="app-page page" data-page="validation" hidden></section>
    <section id="page-storage" class="app-page page" data-page="storage" hidden></section>
    <section id="page-experiments" class="app-page page" data-page="experiments" hidden></section>
    <section id="page-strategies" class="app-page page" data-page="strategies" hidden></section>
    <section id="page-journal" class="app-page page" data-page="journal" hidden></section>
    <section id="page-jobs" class="app-page page" data-page="jobs" hidden></section>
    <section id="page-system" class="app-page page" data-page="system" hidden></section>
    <section id="page-replay" class="page active" data-page="replay">
      <header class="terminal-header">
        <div class="terminal-brand"><span class="terminal-kicker">BINANCE MARKET WORKSTATION</span><h1>DELTA REPLAY</h1></div>
        <div class="market-toolbar" aria-label="Market controls">
          <div class="mode-switch" role="group" aria-label="Market mode">
            <button id="live-mode-btn" class="mode-btn active" type="button" aria-pressed="true">LIVE</button>
            <button id="replay-mode-btn" class="mode-btn" type="button" aria-pressed="false">REPLAY</button>
          </div>
          <label class="toolbar-field">Symbol<select id="symbol-select" aria-label="Symbol"></select></label>
          <label class="toolbar-field">Timeframe<select id="timeframe-select" aria-label="Timeframe"></select></label>
          <label class="toolbar-field replay-dataset-group">Dataset<select id="replay-dataset-select" aria-label="Replay dataset"><option value="">No datasets</option></select></label>
          <button id="replay-dataset-refresh" class="icon-btn" type="button" aria-label="Refresh replay datasets">↻</button>
          <button id="header-start-replay-btn" class="primary-btn replay-only-control" type="button" aria-keyshortcuts="Space">START REPLAY</button>
        </div>
        <div class="header-status"><span class="paper-badge">PAPER</span><span id="data-status" aria-live="polite">LIVE · connecting…</span></div>
      </header>

      <div id="mode-banner" class="mode-banner" aria-live="polite">
        <span id="progress-panel" class="progress-panel hidden"><span id="progress-text"></span><span id="progress-pct"></span><span id="market-time"></span></span>
        <span id="market-time-full">CURRENT MARKET TIME: —</span>
      </div>

      <div id="error-panel" class="error-panel hidden" role="alert">
        <span id="error-panel-title">Data Error</span><p id="error-panel-message"></p><div id="error-panel-context" class="hidden"></div>
        <button id="error-panel-retry" type="button">Retry</button><button id="error-panel-details" type="button">Details</button><button id="error-panel-dismiss" class="error-panel-dismiss" type="button" aria-label="Dismiss error">×</button>
      </div>

      <div class="replay-layout">
        <main class="chart-workspace" aria-label="Market chart workspace">
          <div class="chart-stage"><div id="chart-container" class="chart-container"></div>
            <div id="chart-floating-bar" class="chart-position-chip hidden" aria-live="polite"><span id="chart-pos-icon" aria-hidden="true"></span><span id="chart-pos-symbol"></span><span id="chart-pos-side-text"></span><span id="chart-pos-qty"></span><span class="chip-separator">•</span><span id="chart-pos-entry"></span><span id="chart-pos-mark"></span><span id="chart-pos-pnl"></span><button id="btn-chart-close" type="button" aria-label="Close position">×</button></div>
            <div id="chart-toast" class="chart-toast hidden" role="status" aria-live="polite"></div>
          </div>
        </main>

        <aside id="trading-panel" class="trading-section" aria-labelledby="trading-panel-title">
          <div class="panel-heading"><div><span class="eyebrow">PAPER ACCOUNT</span><h2 id="trading-panel-title">Trading desk</h2></div><span class="paper-badge">SIM</span></div>
          <div class="trading-top-summary"><div class="summary-main"><span>Equity</span><strong id="acct-equity">—</strong></div><div class="summary-side"><span>Unrealized P&amp;L</span><strong id="acct-unrealized">—</strong></div><span id="trading-error" class="trading-error hidden" role="alert"></span></div>
          <div class="trading-tab-nav" role="tablist" aria-label="Trading views"><button class="panel-tab-btn active" type="button" role="tab" id="trade-tab" aria-selected="true" aria-controls="tab-view-trade" data-tab="trade">Trade</button><button class="panel-tab-btn" type="button" role="tab" id="account-tab" aria-selected="false" aria-controls="tab-view-account" data-tab="account" tabindex="-1">Account</button></div>
          <div id="tab-view-trade" class="tab-panel active" role="tabpanel" aria-labelledby="trade-tab" tabindex="0">
            <section id="order-ticket" class="order-ticket is-flat" aria-label="Order ticket">
              <div class="ticket-header"><div><span class="eyebrow">ORDER TICKET</span><p id="ticket-state-hint" class="ticket-state-hint">FLAT • Pick a size</p></div><span id="pos-state-pill" class="pos-state-pill is-flat">FLAT</span></div>
              <div class="ticket-field-grid"><label class="field">Order type<select id="order-type" aria-label="Order type"><option value="MARKET">Market</option><option value="LIMIT">Limit</option><option value="STOP_MARKET">Stop market</option></select></label><label class="field">Quantity<input id="trade-qty" inputmode="decimal" autocomplete="off" placeholder="0.00" aria-describedby="qty-notional"><span id="qty-notional" class="field-hint">≈ $0</span></label><label id="limit-price-row" class="field hidden">Limit price<input id="limit-price" inputmode="decimal" placeholder="0.00"></label><label id="stop-price-row" class="field hidden">Stop price<input id="stop-price" inputmode="decimal" placeholder="0.00"></label></div>
              <button id="advanced-toggle" class="advanced-toggle" type="button" aria-expanded="false">Advanced order controls <span aria-hidden="true">＋</span></button>
              <div class="side-actions"><button id="btn-buy" class="order-action buy btn-buy-main" type="button"><span>Buy / Long</span><kbd>1</kbd></button><button id="btn-sell" class="order-action sell btn-sell-main" type="button"><span>Sell / Short</span><kbd>2</kbd></button></div>
              <details class="risk-details"><summary>Position &amp; risk management</summary><div class="position-card"><div class="position-card-head"><div><span class="eyebrow">OPEN POSITION</span><strong id="pos-symbol">No position</strong></div><span id="pos-side" class="position-side">—</span></div><div class="pos-compact-grid"><div><span>Size</span><strong id="pos-qty">—</strong></div><div><span>Entry</span><strong id="pos-entry">—</strong></div><div><span>Mark</span><strong id="pos-current">—</strong></div><div><span>P&amp;L</span><strong id="pos-pnl">—</strong></div></div><div class="risk-grid"><label class="field">Stop loss<input id="sl-price" inputmode="decimal" placeholder="Optional"></label><label class="field">Take profit<input id="tp-price" inputmode="decimal" placeholder="Optional"></label></div><div class="risk-actions"><button id="btn-set-risk" class="btn btn-secondary" type="button">Set risk</button><button id="btn-clear-risk" class="btn btn-ghost" type="button">Clear</button></div><div class="current-risk"><span>SL <strong id="pos-sl">—</strong></span><span>TP <strong id="pos-tp">—</strong></span></div><div id="ticket-flatten-summary" class="flatten-summary hidden"><div><span>Entry</span><strong id="flatten-entry">—</strong></div><div><span>Mark</span><strong id="flatten-mark">—</strong></div><div><span>P&amp;L</span><strong id="flatten-pnl" class="num">—</strong></div></div><button id="btn-close" class="flatten-button" type="button">Close position</button></div></details>
            </section>
            <section class="activity-card"><div class="section-heading"><span>Pending orders</span><span class="section-count">LIVE</span></div><div id="pending-orders-list" class="activity-list"><span class="empty-hint">No pending orders</span></div><div class="section-heading section-heading-divider"><span>Recent fills</span><span class="section-count">LATEST</span></div><div id="trades-list" class="activity-list"><span class="empty-hint">No fills yet</span></div><div id="ticket-fills-list" class="ticket-fills-list"></div></section>
          </div>
          <div id="tab-view-account" class="tab-panel" role="tabpanel" aria-labelledby="account-tab" tabindex="0"><section class="account-card"><div class="account-stat"><span>Cash balance</span><strong id="acct-balance">—</strong></div><div class="account-stat"><span>Realized P&amp;L</span><strong id="acct-realized">—</strong></div><div class="account-stat"><span>Fees paid</span><strong id="acct-fees">—</strong></div></section><button id="btn-reset-acct" class="btn btn-danger" type="button">Reset paper account</button><p class="account-reset-help">Resets trading balance, positions, orders, and fills. The replay candle position is unchanged.</p></div>
        </aside>
      </div>

      <section class="timeline-section" aria-label="Replay timeline">
        <div class="timeline-header"><span id="timeline-start-label"></span><strong id="timeline-current-label"></strong><span id="timeline-end-label"></span></div>
        <canvas id="timeline-sparkline" aria-hidden="true"></canvas><input type="range" id="timeline-slider" disabled aria-label="Replay position">
        <div class="timeline-meta"><button id="timeline-start-btn" type="button">START HERE</button><span id="start-index-label"></span><span id="start-time-label"></span><span id="timeline-index-label"></span><span id="timeline-time-label"></span></div>
      </section>
      <section class="controls-section" aria-label="Replay controls"><div class="controls-row"><div class="replay-primary"><button id="btn-play" class="replay-play" type="button">PLAY</button><button id="btn-pause" class="replay-play hidden" type="button">PAUSE</button></div><div class="replay-secondary"><button id="btn-step" type="button">STEP</button><button id="btn-reset" type="button">RESET</button></div><label class="replay-speed"><span>SPEED</span><select id="speed-select" aria-label="Replay speed"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="5">5×</option><option value="10">10×</option></select></label><button id="btn-follow" class="replay-follow" type="button">FOLLOW</button><span id="replay-status" aria-live="polite"></span></div></section>
      <div id="accessibility-live" class="sr-only" aria-live="polite" aria-atomic="true"></div><div id="drawer-scrim" aria-hidden="true"></div><button id="btn-trading-drawer" type="button" aria-controls="trading-panel" aria-expanded="false">TRADE</button>
    </section>
  </main>
`;