import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API = import.meta.env.VITE_API_URL ?? '/api/v1';

const seed = [
  { time: 1, open: 100, high: 103, low: 99, close: 102, volume: 12 },
  { time: 2, open: 102, high: 105, low: 101, close: 104, volume: 15 },
  { time: 3, open: 104, high: 106, low: 102, close: 103, volume: 11 },
];

function App() {
  const [state, setState] = useState({ index: -1, total: 0, candle: null });
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${API}/replay/state`)
      .then((r) => { if (!r.ok) throw new Error('API unavailable'); return r.json(); })
      .then((d) => { setState(d); setConnected(true); })
      .catch(() => setConnected(false));
  }, []);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`${API}/replay/load`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candles: seed }) });
      if (!r.ok) throw new Error('Load failed');
      setState(await r.json()); setConnected(true);
    } finally { setLoading(false); }
  }

  async function step() {
    const r = await fetch(`${API}/replay/step`, { method: 'POST' });
    if (r.ok) setState(await r.json());
  }

  async function reset() {
    const r = await fetch(`${API}/replay/reset`, { method: 'POST' });
    if (r.ok) setState(await r.json());
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div><div className="brand">DELTA REPLAY</div><div className="subbrand">RESEARCH TERMINAL 2.0</div></div>
        <div className="status"><span className={`dot ${connected ? 'on' : ''}`} />{connected ? 'ENGINE ONLINE' : 'CONNECTING'}</div>
      </header>
      <section className="toolbar">
        <div><span className="label">MARKET</span><strong>BTCUSDT</strong></div>
        <div><span className="label">TIMEFRAME</span><strong>15m</strong></div>
        <div className="toolbar-actions"><button onClick={load} disabled={loading}>{loading ? 'LOADING…' : 'LOAD DATA'}</button><button onClick={reset}>RESET</button><button className="primary" onClick={step}>STEP ▶</button></div>
      </section>
      <main className="workspace">
        <section className="chart-panel">
          <div className="panel-head"><div><span className="eyebrow">REPLAY</span><h1>Market Replay</h1></div><div className="bar-count">BAR {state.total ? state.index + 1 : 0} / {state.total}</div></div>
          <div className="chart-stage">
            {state.candle ? <div className="candle-card"><span>O {state.candle.open}</span><span>H {state.candle.high}</span><span>L {state.candle.low}</span><span>C {state.candle.close}</span><span>V {state.candle.volume}</span></div> : <div className="empty-state"><div className="empty-icon">◫</div><h2>Ready to replay</h2><p>Load a candle dataset to begin.</p><button className="primary" onClick={load}>LOAD SAMPLE DATA</button></div>}
          </div>
          <div className="timeline"><div className="track"><div className="fill" style={{ width: state.total ? `${((state.index + 1) / state.total) * 100}%` : '0%' }} /></div><div className="timeline-meta"><span>START</span><strong>{state.candle ? `CLOSE ${state.candle.close}` : 'NO DATA'}</strong><span>END</span></div></div>
        </section>
        <aside className="trade-panel">
          <div className="panel-head compact"><div><span className="eyebrow">PAPER ACCOUNT</span><h2>Trading</h2></div><span className="paper-pill">PAPER</span></div>
          <div className="account-card"><span>Account equity</span><strong>$10,000.00</strong></div>
          <div className="position-card"><div className="card-title">POSITION</div><div className="placeholder">No open position</div></div>
          <div className="order-card"><div className="card-title">ORDER</div><label>Quantity<input value="0.10" readOnly /></label><div className="side-by-side"><button className="buy">BUY / LONG</button><button className="sell">SELL / SHORT</button></div><button className="close">CLOSE POSITION</button></div>
        </aside>
      </main>
      <footer className="footer"><span>Python engine boundary active</span><span>Replay index: {state.index}</span></footer>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
