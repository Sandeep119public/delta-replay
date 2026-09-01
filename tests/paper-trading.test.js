import { describe, it, expect } from 'vitest';
import { PaperTradingEngine } from '../src/trading/PaperTradingEngine.js';
import { ReplayEngine } from '../src/replay/ReplayEngine.js';

function candle(time, close) {
  return { time, open: close, high: close + 1, low: close - 1, close, volume: 10 };
}
function sendCandle(engine, c) {
  engine.onMarketCandle({ candle: c, index: 0, timestamp: c.time });
}

describe('PaperTrading — Account', () => {
  it('starting balance 10000 and equity = cash + unrealized', () => {
    const t = new PaperTradingEngine({ startingBalance: 10000 });
    const a = t.getAccountSnapshot();
    expect(a.cashBalance).toBe(10000);
    expect(a.equity).toBe(10000);
    expect(a.realizedPnL).toBe(0);
    expect(a.unrealizedPnL).toBe(0);
  });

  it('reset account clears positions/trades and restores balance', () => {
    const t = new PaperTradingEngine({ startingBalance: 10000 });
    sendCandle(t, candle(1000, 100));
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    sendCandle(t, candle(1001, 110));
    t.closePosition('BTCUSD');
    expect(t.getTrades().length).toBe(1);
    t.resetAccount();
    expect(t.getAccountSnapshot().cashBalance).toBe(10000);
    expect(t.getPositions().length).toBe(0);
    expect(t.getTrades().length).toBe(0);
  });

  it('equity calculation with open position', () => {
    const t = new PaperTradingEngine({ startingBalance: 10000 });
    sendCandle(t, candle(1000, 100));
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 2 });
    sendCandle(t, candle(1001, 110)); // unrealized 20
    const a = t.getAccountSnapshot();
    expect(a.unrealizedPnL).toBe(20);
    expect(a.equity).toBe(10020);
  });
});

describe('PaperTrading — LONG', () => {
  it('open long', () => {
    const t = new PaperTradingEngine({});
    sendCandle(t, candle(1000, 100));
    const res = t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    expect(res.success).toBe(true);
    const p = t.getPosition('BTCUSD');
    expect(p.side).toBe('LONG');
    expect(p.entryPrice).toBe(100);
    expect(p.quantity).toBe(1);
  });

  it('unrealized profit long', () => {
    const t = new PaperTradingEngine({});
    sendCandle(t, candle(1000, 100));
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 2 });
    sendCandle(t, candle(1001, 105));
    expect(t.getPosition('BTCUSD').unrealizedPnL).toBe(10);
  });

  it('unrealized loss long', () => {
    const t = new PaperTradingEngine({});
    sendCandle(t, candle(1000, 100));
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    sendCandle(t, candle(1001, 90));
    expect(t.getPosition('BTCUSD').unrealizedPnL).toBe(-10);
  });

  it('close long profit', () => {
    const t = new PaperTradingEngine({ startingBalance: 10000 });
    sendCandle(t, candle(1000, 100));
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    sendCandle(t, candle(1001, 120));
    const res = t.closePosition('BTCUSD');
    expect(res.success).toBe(true);
    expect(res.realizedPnL).toBe(20);
    expect(t.getAccountSnapshot().cashBalance).toBe(10020);
    expect(t.getAccountSnapshot().realizedPnL).toBe(20);
  });

  it('close long loss', () => {
    const t = new PaperTradingEngine({ startingBalance: 10000 });
    sendCandle(t, candle(1000, 100));
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    sendCandle(t, candle(1001, 80));
    const res = t.closePosition('BTCUSD');
    expect(res.realizedPnL).toBe(-20);
    expect(t.getAccountSnapshot().cashBalance).toBe(9980);
  });
});

describe('PaperTrading — SHORT', () => {
  it('open short', () => {
    const t = new PaperTradingEngine({});
    sendCandle(t, candle(1000, 100));
    const res = t.placeOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1 });
    expect(res.success).toBe(true);
    expect(t.getPosition('BTCUSD').side).toBe('SHORT');
  });

  it('unrealized profit short when price drops', () => {
    const t = new PaperTradingEngine({});
    sendCandle(t, candle(1000, 100));
    t.placeOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1 });
    sendCandle(t, candle(1001, 80));
    expect(t.getPosition('BTCUSD').unrealizedPnL).toBe(20);
  });

  it('unrealized loss short when price rises', () => {
    const t = new PaperTradingEngine({});
    sendCandle(t, candle(1000, 100));
    t.placeOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1 });
    sendCandle(t, candle(1001, 120));
    expect(t.getPosition('BTCUSD').unrealizedPnL).toBe(-20);
  });

  it('close short profit', () => {
    const t = new PaperTradingEngine({ startingBalance: 5000 });
    sendCandle(t, candle(1000, 100));
    t.placeOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 2 });
    sendCandle(t, candle(1001, 90));
    const res = t.closePosition('BTCUSD');
    expect(res.realizedPnL).toBe(20);
    expect(t.getAccountSnapshot().cashBalance).toBe(5020);
  });

  it('close short loss', () => {
    const t = new PaperTradingEngine({ startingBalance: 5000 });
    sendCandle(t, candle(1000, 100));
    t.placeOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1 });
    sendCandle(t, candle(1001, 110));
    const res = t.closePosition('BTCUSD');
    expect(res.realizedPnL).toBe(-10);
  });
});

describe('PaperTrading — validation', () => {
  it('reject zero quantity', () => {
    const t = new PaperTradingEngine({});
    sendCandle(t, candle(1000, 100));
    const res = t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 0 });
    expect(res.success).toBe(false);
    expect(res.code).toBe('INVALID_QUANTITY');
  });
  it('reject negative quantity', () => {
    const t = new PaperTradingEngine({});
    sendCandle(t, candle(1000, 100));
    expect(t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: -1 }).code).toBe('INVALID_QUANTITY');
  });
  it('reject NaN', () => {
    const t = new PaperTradingEngine({});
    sendCandle(t, candle(1000, 100));
    expect(t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: NaN }).code).toBe('INVALID_QUANTITY');
  });
  it('reject no market price', () => {
    const t = new PaperTradingEngine({});
    const res = t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    expect(res.code).toBe('NO_MARKET_PRICE');
  });
  it('reject invalid side', () => {
    const t = new PaperTradingEngine({});
    sendCandle(t, candle(1000, 100));
    expect(t.placeOrder({ symbol: 'BTCUSD', side: 'HOLD', quantity: 1 }).code).toBe('INVALID_SIDE');
  });
  it('reject invalid symbol', () => {
    const t = new PaperTradingEngine({});
    sendCandle(t, candle(1000, 100));
    expect(t.placeOrder({ symbol: '', side: 'BUY', quantity: 1 }).code).toBe('INVALID_SYMBOL');
  });
});

describe('PaperTrading — position rules', () => {
  it('cannot open duplicate same-side position', () => {
    const t = new PaperTradingEngine({});
    sendCandle(t, candle(1000, 100));
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    const res = t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    expect(res.code).toBe('POSITION_ALREADY_OPEN');
  });

  it('opposite-side closes existing position (no auto-reverse)', () => {
    const t = new PaperTradingEngine({ startingBalance: 10000 });
    sendCandle(t, candle(1000, 100));
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    sendCandle(t, candle(1001, 110));
    const res = t.placeOrder({ symbol: 'BTCUSD', side: 'SELL', quantity: 1 });
    expect(res.success).toBe(true);
    expect(res.realizedPnL).toBe(10);
    expect(t.getPosition('BTCUSD')).toBeNull();
    expect(t.getPositions().length).toBe(0);
    // Not auto-reversed to short
  });

  it('close when no position rejected', () => {
    const t = new PaperTradingEngine({});
    sendCandle(t, candle(1000, 100));
    expect(t.closePosition('BTCUSD').code).toBe('NO_POSITION');
  });
});

describe('PaperTrading — replay integration', () => {
  it('receives MARKET_CANDLE and updates current price & PnL exactly once per candle', () => {
    const replay = new ReplayEngine();
    const trading = new PaperTradingEngine({ replayEngine: replay });
    const candles = [
      candle(1000, 100), candle(1001, 105), candle(1002, 110)
    ].map((c, i) => ({ time: c.time, open: c.close, high: c.close + 1, low: c.close - 1, close: c.close, volume: 10 }));
    replay.load(candles);
    replay.start(0); // triggers MARKET_CANDLE with 100
    trading.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    expect(trading.getPosition('BTCUSD').unrealizedPnL).toBe(0);
    let updates = 0;
    trading.on('positionUpdated', () => updates++);
    replay.stepForward(); // 105
    expect(trading.getPosition('BTCUSD').currentPrice).toBe(105);
    expect(trading.getPosition('BTCUSD').unrealizedPnL).toBe(5);
    expect(updates).toBe(1);
    replay.stepForward(); // 110
    expect(trading.getPosition('BTCUSD').unrealizedPnL).toBe(10);
    expect(updates).toBe(2);
  });

  it('determinism: same sequence twice yields same PnL/balance/trades', () => {
    function runOnce() {
      const t = new PaperTradingEngine({});
      const seq = [100, 105, 95, 110];
      seq.forEach((price, i) => {
        sendCandle(t, candle(1000 + i, price));
        if (i === 0) t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
        if (i === 3) t.closePosition('BTCUSD');
      });
      return { balance: t.getAccountSnapshot().cashBalance, trades: t.getTrades() };
    }
    const a = runOnce();
    const b = runOnce();
    expect(a.balance).toBe(b.balance);
    expect(JSON.stringify(a.trades)).toBe(JSON.stringify(b.trades));
  });
});

describe('PaperTrading — future-data safety', () => {
  it('engine has no access to AppState or ReplayEngine internals', () => {
    const t = new PaperTradingEngine({});
    // Ensure no properties reference external arrays
    expect(t._latestCandle).toBeNull();
    sendCandle(t, candle(1000, 100));
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    // Latest candle should be clone, not reference to external full array
    const srcKeys = Object.keys(t);
    expect(srcKeys).not.toContain('candles');
    expect(srcKeys).not.toContain('_candles');
    expect(t.getLatestCandle()).toEqual({ time: 1000, open: 100, high: 101, low: 99, close: 100, volume: 10 });
  });

  it('trading engine works using only candle events, not ReplayEngine._candles', () => {
    const replay = new ReplayEngine();
    const trading = new PaperTradingEngine({ replayEngine: replay });
    const candles = [candle(1000, 100), candle(1001, 200)].map(c => ({ time: c.time, open: c.close, high: c.close + 1, low: c.close - 1, close: c.close, volume: 10 }));
    replay.load(candles);
    replay.start(0);
    trading.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    // Try to verify trading did not read replay._candles directly
    expect(trading._latestCandle.close).toBe(100);
    replay.stepForward();
    expect(trading.getPosition('BTCUSD').currentPrice).toBe(200);
  });
});

describe('PaperTrading — seek safety', () => {
  it('canSeek false while position open, true after close', () => {
    const t = new PaperTradingEngine({});
    sendCandle(t, candle(1000, 100));
    expect(t.canSeek()).toBe(true);
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    expect(t.canSeek()).toBe(false);
    expect(t.hasOpenPosition()).toBe(true);
    sendCandle(t, candle(1001, 110));
    t.closePosition('BTCUSD');
    expect(t.canSeek()).toBe(true);
  });

  it('seek blocked behavior documented: UI should check hasOpenPosition before engine.seek', () => {
    // Simulate UI guard
    const replay = new ReplayEngine();
    const trading = new PaperTradingEngine({ replayEngine: replay });
    const candles = [candle(1000, 100), candle(1001, 110), candle(1002, 120)].map(c => ({ time: c.time, open: c.close, high: c.close + 1, low: c.close - 1, close: c.close, volume: 10 }));
    replay.load(candles);
    replay.start(0);
    trading.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 1 });
    // Attempt seek should be blocked
    const shouldBlock = trading.hasOpenPosition();
    expect(shouldBlock).toBe(true);
    if (!shouldBlock) replay.seek(2);
    // Verify still at 0
    expect(replay.getState().currentIndex).toBe(0);
  });
});

describe('PaperTrading — trade history', () => {
  it('records closed trade with correct fields', () => {
    const t = new PaperTradingEngine({});
    sendCandle(t, candle(1000, 100));
    t.placeOrder({ symbol: 'BTCUSD', side: 'BUY', quantity: 2 });
    sendCandle(t, candle(1001, 150));
    t.closePosition('BTCUSD');
    const trades = t.getTrades();
    expect(trades.length).toBe(1);
    const tr = trades[0];
    expect(tr.symbol).toBe('BTCUSD');
    expect(tr.side).toBe('LONG');
    expect(tr.quantity).toBe(2);
    expect(tr.entryPrice).toBe(100);
    expect(tr.exitPrice).toBe(150);
    expect(tr.realizedPnL).toBe(100);
    expect(tr.openedAt).toBe(1000);
    expect(tr.closedAt).toBe(1001);
    expect(tr.id).toBe(1);
  });
});
