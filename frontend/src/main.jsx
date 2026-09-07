import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReplayChart } from './components/ReplayChart';
import './styles.css';

const API = import.meta.env.VITE_API_URL ?? '/api/v1';
const seed = [
  { time: 1710000000, open: 62000, high: 62400, low: 61800, close: 62200, volume: 120 },
  { time: 1710000900, open: 62200, high: 62900, low: 62100, close: 62700, volume: 155 },
  { time: 1710001800, open: 62700, high: 63050, low: 62400, close: 62500, volume: 111 },
  { time: 1710002700, open: 62500, high: 63200, low: 62300, close: 63150, volume: 188 },
  { time: 1710003600, open: 63150, high: 63500, low: 62800, close: 63350, volume: 142 },
  { time: 1710004500, open: 63350, high: 63800, low: 63000, close: 63600, volume: 204 },
];

const initialReplay = { status: 'idle', index: -1, startIndex: -1, total: 0, speed: 1, candle: null, visibleCandles: [] };
const initialAccount = { balance: 10000, equity: 10000, position: null, unrealizedPnl: 0, totalFees: 0 };

function App() {
  const [state, setState] = useState(initialReplay);
  const [account, setAccount] = useState(initialAccount);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [quantity, setQuantity] = useState('0.10');
  const [tradeError, setTradeError] = useState('');
  const [uploading, setUploading] = useState(false);

  const request = async (path, options) => {
    const response = await fetch(`${API}${path}`, options);
    if (!response.ok) {
      let message = 'Request failed';
      try { message = (await response.json()).detail || message; } catch {}
      throw new Error(message);
    }
    return response.json();
  };

  const syncAccount = async () => {
    try { setAccount(await request('/trading/state')); } catch {}
  };

  useEffect(() => {
    request('/replay/state').then((data) => { setState(data); setConnected(true); }).catch(() => setConnected(false));
    syncAccount();
  }, []);

  const applyCandles = async (candles) => {
    await request('/replay/load', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candles }) });
    const started = await request('/replay/start/0', { method: 'POST' });
    setState(started); setPlaying(false); setConnected(true); await request('/trading/reset', { method: 'POST' }); await syncAccount();
  };

  const load = async () => {
    setLoading(true); setTradeError('');
    try { await applyCandles(seed); } catch (error) { setTradeError(error.message); }
    finally { setLoading(false); }
  };

  const upload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(true); setTradeError('');
    try {
      const form = new FormData(); form.append('file', file);
      const data = await request('/data/csv', { method: 'POST', body: form });
      await applyCandles(data.candles);
    } catch (error) { setTradeError(error.message); }
    finally { setUploading(false); }
  };

  const step = async () => { try { const data = await request('/replay/step', { method: 'POST' }); setState(data); setPlaying(false); await syncAccount(); } catch (error) { setTradeError(error.message); } };
  const reset = async () => { try { setState(await request('/replay/reset', { method: 'POST' })); setPlaying(false); await request('/trading/reset', { method: 'POST' }); await syncAccount(); } catch (error) { setTradeError(error.message); } };
  const seek = async (index) => { try { setState(await request(`/replay/seek/${index}`, { method: 'POST' })); setPlaying(false); await syncAccount(); } catch (error) { setTradeError(error.message); } };

  useEffect(() => {
    if (!playing || state.index < 0 || state.index >= state.total - 1) return undefined;
    const timer = window.setTimeout(step, 1000 / Math.max(state.speed || 1, 0.25));
    return () => window.clearTimeout(timer);
  }, [playing, state.index, state.total, state.speed]);

  const togglePlay = () => { if (state.index >= 0 && state.index < state.total - 1) setPlaying((value) => !value); };

  const trade = async (side) => {
    setTradeError('');
    try { setAccount(await request('/trading/order', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ side, quantity: Number(quantity) }) })); }
    catch (error) { setTradeError(error.message); }
  };

  const closePosition = async () => { setTradeError(''); try { setAccount(await request('/trading/close', { method: 'POST' })); } catch (error) { setTradeError(error.message); } };
  const progress = state.total ? ((state.index + 1) / state.total) * 100 : 0;
  const price = state.candle?.close ?? 0;

  return (
    <div className="app-shell">
      <header className="topbar"><div><div className="brand">DELTA REPLAY</div><div className="subbrand">PYTHON RESEARCH TERMINAL 2.0</div></div><div className="status"><span className={`dot ${connected ? 'on' : ''}`} />{connected ? 'ENGINE ONLINE' : 'CONNECTING'}</div></header>
      <section className="toolbar"><div className="market-chip"><span className="label">MARKET</span><strong>BTCUSDT</strong></div><div className="market-chip"><span className="label">TIMEFRAME</span><strong>15m</strong></div><div className="market-chip"><span className="label">LAST</span><strong>{price ? `$${price.toLocaleString()}` : '—'}</strong></div><div className="toolbar-actions"><label className="upload-button">{uploading ? 'IMPORTING…' : 'IMPORT CSV'}<input type="file" accept=".csv,text/csv" onChange={upload} disabled={uploading} hidden /></label><button onClick={load} disabled={loading}>{loading ? 'LOADING…' : 'LOAD SAMPLE'}</button><button onClick={reset}>RESET</button><button className="primary" onClick={togglePlay}>{playing ? 'PAUSE' : 'PLAY'} ▶</button><button className="primary" onClick={step}>STEP ▷</button></div></section>
      <main className="workspace">
        <section className="chart-panel"><div className="panel-head"><div><span className="eyebrow">MARKET REPLAY</span><h1>BTCUSDT · 15m</h1></div><div className="bar-count">BAR {state.total ? state.index + 1 : 0} / {state.total}</div></div><div className="chart-stage"><ReplayChart candles={state.visibleCandles} />{!state.total && <div className="empty-state"><div className="empty-icon">◫</div><h2>Ready to replay</h2><p>Import a CSV or load the sample market.</p></div>}</div><div className="timeline"><input className="scrubber" type="range" min="0" max={Math.max(state.total - 1, 0)} value={Math.max(state.index, 0)} disabled={!state.total} onChange={(event) => seek(Number(event.target.value))} style={{ '--progress': `${progress}%` }} /><div className="timeline-meta"><span>REPLAY</span><strong>{state.candle ? new Date(state.candle.time * 1000).toLocaleString() : 'LOAD DATA TO BEGIN'}</strong><span>{state.status.toUpperCase()}</span></div></div></section>
        <aside className="trade-panel"><div className="panel-head compact"><div><span className="eyebrow">PAPER ACCOUNT</span><h2>Trading</h2></div><span className="paper-pill">PAPER</span></div><div className="account-card"><span>Equity</span><strong>${account.equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong><small>Balance ${account.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</small></div><div className="metrics"><div><span>MARK</span><strong>{price ? price.toLocaleString() : '—'}</strong></div><div><span>UNREALIZED</span><strong className={account.unrealizedPnl >= 0 ? 'positive' : 'negative'}>{account.unrealizedPnl >= 0 ? '+' : ''}{account.unrealizedPnl.toFixed(2)}</strong></div></div><div className="position-card"><div className="card-title">POSITION</div><div className="placeholder">{account.position ? `${account.position.side.toUpperCase()} · ${account.position.quantity} @ ${account.position.entry_price}` : 'No open position'}</div></div><div className="order-card"><div className="card-title">ORDER</div><label>Quantity<input inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><div className="side-by-side"><button className="buy" onClick={() => trade('buy')}>BUY / LONG</button><button className="sell" onClick={() => trade('sell')}>SELL / SHORT</button></div><button className="close" onClick={closePosition}>CLOSE POSITION</button>{tradeError && <p className="trade-error">{tradeError}</p>}</div><div className="engine-note">Python FastAPI · deterministic replay · paper execution</div></aside>
      </main>
      <footer className="footer"><span>{state.total ? `${state.total} candles loaded` : 'No dataset loaded'}</span><span>Replay {Math.max(state.index + 1, 0)}/{state.total}</span></footer>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
