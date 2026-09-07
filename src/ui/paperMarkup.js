/**
 * Paper UI markup.
 * index.html is intentionally only a bootstrap shell; all application markup
 * belongs to the UI layer so the visual surface can evolve independently.
 */
export const paperMarkup = () => `
  <div id="page-replay" class="page active" data-page="replay">
    <header class="topbar" role="banner">
      <div class="topbar-left"><h1 class="logo">DELTA REPLAY</h1></div>
      <nav class="topbar-center" aria-label="Dataset setup">
        <div class="selector-group symbol-group"><label for="symbol-select">Symbol</label><select id="symbol-select"></select></div>
        <div class="selector-group tf-group"><label for="timeframe-select">Timeframe</label><select id="timeframe-select"></select></div>
        <div class="selector-group replay-date-group"><label for="replay-date">Dataset Date</label><input type="date" id="replay-date"></div>
        <div class="preset-group"><label>Range</label><div class="preset-chips"><button class="preset-chip" data-preset="1d">1D</button><button class="preset-chip" data-preset="7d">7D</button><button class="preset-chip" data-preset="now">LIVE</button></div></div>
        <button id="header-start-replay-btn" class="btn btn-primary">START REPLAY</button>
        <div class="hidden"><input id="from-date"><input id="from-time"><input id="to-date"><input id="to-time"><button id="load-btn">LOAD</button></div>
      </nav>
      <div class="topbar-right"><span class="paper-badge">PAPER</span><span id="data-status">Ready to replay</span></div>
    </header>
    <div id="mode-banner" class="mode-banner"><span id="progress-panel" class="hidden"><span id="progress-text"></span><span id="progress-pct"></span><span id="market-time"></span></span><span id="market-time-full">CURRENT MARKET TIME: —</span><span id="sr-ticker" class="sr-only"></span></div>
    <div id="error-panel" class="error-panel hidden"><div class="error-panel-header"><span id="error-panel-title">Data Error</span><button id="error-panel-dismiss">×</button></div><p id="error-panel-message"></p><div id="error-panel-context" class="hidden"></div><button id="error-panel-retry">Retry</button><button id="error-panel-details">Details</button></div>
    <div class="main-layout">
      <main class="main"><div id="chart-container"></div><div id="chart-floating-bar" class="hidden"><span id="chart-pos-icon"></span><span id="chart-pos-symbol"></span><span id="chart-pos-side-text"></span><span id="chart-pos-qty"></span><span id="chart-pos-entry"></span><span id="chart-pos-mark"></span><span id="chart-pos-pnl"></span><button id="btn-chart-close">×</button></div><div id="chart-toast" class="hidden"></div><div id="chart-overlay" class="hidden"><p id="overlay-text"></p></div></main>
      <aside id="trading-panel" class="trading-section">
        <div class="trading-top-summary"><div class="trading-header"><h2>SIMULATOR</h2><span id="pos-state-pill">FLAT</span><span id="trading-error" class="hidden"></span></div><span id="acct-equity">$10,000.00</span><span id="acct-unrealized">$0.00</span></div>
        <div class="trading-tab-nav"><button class="panel-tab-btn active" data-tab="trade">TRADE</button><button class="panel-tab-btn" data-tab="account">ACCOUNT</button><button class="panel-tab-btn" data-tab="activity">ACTIVITY</button></div>
        <div id="tab-view-trade" class="tab-panel active">
          <div class="compact-card"><span>ACTIVE POSITION</span><div><span id="pos-symbol">—</span><span id="pos-side">—</span><span id="pos-qty">—</span><span id="pos-entry">—</span><span id="pos-current">—</span><span id="pos-pnl">—</span><span id="pos-sl" class="hidden"></span><span id="pos-tp" class="hidden"></span></div><input id="sl-price"><input id="tp-price"><button id="btn-set-risk">SET</button><button id="btn-clear-risk">CLEAR</button></div>
          <div class="compact-card"><span>ORDER TICKET</span><select id="order-type"><option value="MARKET">Market</option><option value="LIMIT">Limit</option><option value="STOP_MARKET">Stop</option></select><input id="trade-qty" type="number" value="1"><input id="limit-price"><input id="stop-price"><button id="btn-buy">BUY / LONG</button><button id="btn-sell">SELL / SHORT</button><button id="btn-close">CLOSE POSITION</button><div id="pending-orders-list"></div><div id="trades-list"></div></div>
        </div>
        <div id="tab-view-account" class="tab-panel"><span id="acct-balance"></span><span id="acct-realized"></span><span id="acct-fees"></span><button id="btn-reset-acct">RESET ACCOUNT</button></div>
        <div id="tab-view-activity" class="tab-panel"><div id="ticket-fills-list"></div></div>
      </aside>
    </div>
    <section class="timeline-section"><div class="timeline-header"><span id="timeline-start-label">—</span><span id="timeline-current-label">—</span><span id="timeline-end-label">—</span></div><canvas id="timeline-sparkline"></canvas><input type="range" id="timeline-slider" min="0" max="100" value="0" disabled><button id="timeline-start-btn">START HERE</button><span id="start-index-label"></span><span id="start-time-label"></span><span id="timeline-index-label"></span><span id="timeline-time-label"></span><div class="hidden"><input id="jump-date"><input id="jump-time"><button id="jump-btn">JUMP</button><span id="jump-error"></span><button id="start-replay-btn">START</button></div></section>
    <section class="controls-section"><div class="controls-row"><button id="btn-reset">RESET</button><button id="btn-play">PLAY</button><button id="btn-pause" class="hidden">PAUSE</button><button id="btn-step">STEP</button><select id="speed-select"><option value="1">1x</option><option value="2">2x</option></select><button id="btn-follow">FOLLOW</button></div></section>
  </div>
  <div id="drawer-scrim"></div><button id="btn-trading-drawer">TRADE</button>
`;
