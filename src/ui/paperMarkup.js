import { headerMarkup } from './paper/markup/Header.js';
import { workspaceMarkup } from './paper/markup/Workspace.js';
import { timelineMarkup } from './paper/markup/Timeline.js';

export const paperMarkup = () => `
  <div id="page-replay" class="page active" data-page="replay">
    ${headerMarkup()}
    <div id="mode-banner" class="mode-banner"><span id="progress-panel" class="hidden"><span id="progress-text"></span><span id="progress-pct"></span><span id="market-time"></span></span><span id="market-time-full">CURRENT MARKET TIME: —</span></div>
    <div id="error-panel" class="error-panel hidden"><span id="error-panel-title">Data Error</span><p id="error-panel-message"></p><div id="error-panel-context" class="hidden"></div><button id="error-panel-retry">Retry</button><button id="error-panel-dismiss">×</button><button id="error-panel-details">Details</button></div>
    ${workspaceMarkup()}
    ${timelineMarkup()}
  </div>
  <div id="drawer-scrim"></div><button id="btn-trading-drawer">TRADE</button>
`;
