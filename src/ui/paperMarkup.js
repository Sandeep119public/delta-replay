import { headerMarkup } from './paper/markup/Header.js';
import { workspaceMarkup } from './paper/markup/Workspace.js';
import { timelineMarkup } from './paper/markup/Timeline.js';
import { appShellMarkup } from './paper/markup/AppShell.js';

export const paperMarkup = () => appShellMarkup().replace('REPLAY_CONTENT', `
  ${headerMarkup()}
  <div id="mode-banner" class="mode-banner">
    <span id="progress-panel" class="progress-panel hidden">
      <span id="progress-text"></span>
      <span id="progress-pct"></span>
      <span id="market-time"></span>
    </span>
    <span id="market-time-full">CURRENT MARKET TIME: —</span>
  </div>
  <div id="error-panel" class="error-panel hidden">
    <span id="error-panel-title">Data Error</span>
    <p id="error-panel-message"></p>
    <div id="error-panel-context" class="hidden"></div>
    <button id="error-panel-retry" type="button">Retry</button>
    <button id="error-panel-dismiss" class="error-panel-dismiss" type="button" aria-label="Dismiss error">×</button>
    <button id="error-panel-details" type="button">Details</button>
  </div>
  ${workspaceMarkup()}
  ${timelineMarkup()}
`) + `
  <div id="accessibility-live" class="sr-only" aria-live="polite" aria-atomic="true"></div>
  <div id="drawer-scrim" aria-hidden="true"></div>
  <button id="btn-trading-drawer" type="button" aria-controls="trading-panel" aria-expanded="false">TRADE</button>
`;
