# Delta Paper Lab

A lightweight Android paper-trading terminal, separate from the main Delta Replay app. Not affiliated with Delta Exchange.

## Version 0.2.0
- Replaced the chart/replay panel with a compact market watchlist and live ticker detail panel.
- Displays last price, 24-hour change/high/low, mark price, open interest, best bid/ask, turnover and feed freshness.
- Uses Delta Exchange India's public ticker endpoint through a native Android HTTP bridge to avoid WebView file-origin CORS problems. Polls every five seconds and exposes explicit LIVE, STALE and OFFLINE states. It does not invent prices when the feed is unavailable.
- Redesigned phone-first portfolio, order entry, open positions, pending limits and recent activity.
- Paper wallet is denominated in USD to match the quote-price display. P&L uses a simplified linear quantity model, a configurable virtual balance, and simulated fees.
- Market orders and limit orders, leverage selection, optional stop loss/take profit, position closing, local persistence, and pending-order cancellation.
- No exchange login, API key, private account access, or real-money order submission.

## Build
GitHub Actions workflow: `.github/workflows/build-delta-paper-apk.yml`. Open the repository Actions tab, choose **Build Delta Paper Lab APK**, open a successful run, and download `delta-paper-lab-debug-apk`.

Manual build: JDK 17, Android SDK Platform 35, Android Gradle Plugin 8.7.3, Gradle 8.9. From this directory run `gradle assembleDebug`.

## Important limitations
The public API and network path must be tested on the target device. Data is polled, not streamed over WebSocket. The paper engine does not reproduce Delta's exact contract multipliers, INR settlement, funding, margin tiers, liquidation or exchange execution rules. Stop/target simulation checks observed ticker updates, so it is educational and not a guarantee of fill behavior.
