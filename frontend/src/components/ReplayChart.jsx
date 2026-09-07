import { useEffect, useRef } from 'react';
import { createChart, CrosshairMode } from 'lightweight-charts';

export function ReplayChart({ candles }) {
  const hostRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const chart = createChart(host, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: '#8f9aaa' },
      grid: { vertLines: { color: '#202631' }, horzLines: { color: '#202631' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#2b3440' },
      timeScale: { borderColor: '#2b3440', timeVisible: true, secondsVisible: false },
    });
    const series = chart.addCandlestickSeries({ upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350' });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => { chart.remove(); chartRef.current = null; seriesRef.current = null; };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    series.setData((candles || []).map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));
    if (candles?.length) chartRef.current?.timeScale().fitContent();
  }, [candles]);

  return <div ref={hostRef} className="chart-canvas" aria-label="Market replay candlestick chart" />;
}
