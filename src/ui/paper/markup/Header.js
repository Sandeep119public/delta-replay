export const headerMarkup = () => `<header class="topbar">
  <div class="topbar-left">
    <h1 class="logo">DELTA REPLAY</h1>
    <span class="terminal-subtitle">BINANCE MARKET WORKSTATION</span>
  </div>
  <nav class="topbar-center" aria-label="Market controls">
    <div class="selector-group mode-group" role="group" aria-label="Market mode">
      <button id="live-mode-btn" class="mode-btn active" type="button" aria-pressed="true">LIVE</button>
      <button id="replay-mode-btn" class="mode-btn" type="button" aria-pressed="false">REPLAY</button>
    </div>
    <div class="selector-group symbol-group">
      <label for="symbol-select">Symbol</label>
      <select id="symbol-select" aria-label="Symbol"></select>
    </div>
    <div class="selector-group tf-group">
      <label for="timeframe-select">Timeframe</label>
      <select id="timeframe-select" aria-label="Timeframe"></select>
    </div>
    <div class="selector-group replay-dataset-group">
      <label for="replay-dataset-select">Replay dataset</label>
      <select id="replay-dataset-select" aria-label="Replay dataset">
        <option value="">No datasets</option>
      </select>
      <button id="replay-dataset-refresh" type="button" aria-label="Refresh replay datasets">↻</button>
    </div>
    <button id="header-start-replay-btn" class="btn btn-primary replay-only-control" type="button" aria-keyshortcuts="Space">START REPLAY</button>
    <div class="selector-group date-group compat-control">
      <label for="replay-date">Replay date</label>
      <input id="replay-date" type="date" aria-label="Replay date">
      <input id="replay-time" type="time" aria-label="Replay time">
    </div>
    <input id="from-date" class="compat-control" aria-hidden="true" tabindex="-1">
    <input id="from-time" class="compat-control" aria-hidden="true" tabindex="-1">
    <input id="to-date" class="compat-control" aria-hidden="true" tabindex="-1">
    <input id="to-time" class="compat-control" aria-hidden="true" tabindex="-1">
    <button id="load-btn" class="compat-control" aria-hidden="true" tabindex="-1" type="button"></button>
  </nav>
  <div class="topbar-right">
    <span id="cache-badge" class="hidden"></span>
    <span class="paper-badge">PAPER</span>
    <span id="data-status" aria-live="polite">LIVE · connecting…</span>
  </div>
</header>`;
