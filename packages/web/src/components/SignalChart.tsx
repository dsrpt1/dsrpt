'use client';

import { useEffect, useRef, useState } from 'react';

type DataPoint = {
  ts: string;
  price: number;
  regime: string;
  regime_id: number;
  confidence: number;
  peg_dev_bps: number;
  max_severity: number;
};

type EventMarker = {
  ts: string;
  type: string;
  regime: string;
  prev_regime: string;
};

type ChartData = {
  asset: string;
  data: DataPoint[];
  events: EventMarker[];
};

const REGIME_COLORS: Record<number, string> = {
  0: '#6b7280', // ambiguous
  1: '#3b82f6', // contained_stress
  2: '#f59e0b', // liquidity_dislocation
  3: '#f97316', // collateral_shock
  4: '#ef4444', // reflexive_collapse
};

const RANGE_OPTIONS = [
  { label: '1D', value: '1d' },
  { label: '7D', value: '7d' },
  { label: '30D', value: '30d' },
  { label: '90D', value: '90d' },
];

export default function SignalChart({ symbol = 'USDC' }: { symbol?: string }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<unknown>(null);
  const [range, setRange] = useState('7d');
  const [data, setData] = useState<ChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Fetch data
  useEffect(() => {
    setLoading(true);
    setError('');
    fetch(`/api/v1/history?symbol=${symbol}&range=${range}`)
      .then(r => {
        if (!r.ok) throw new Error(`API error: ${r.status}`);
        return r.json();
      })
      .then(d => {
        setData(d);
        setLoading(false);
      })
      .catch(e => {
        setError(e.message);
        setLoading(false);
      });
  }, [symbol, range]);

  // Render chart
  useEffect(() => {
    if (!data || !chartRef.current || data.data.length === 0) return;

    let cancelled = false;

    import('lightweight-charts').then(({ createChart, ColorType, LineStyle }) => {
      if (cancelled || !chartRef.current) return;

      // Clean up previous chart
      if (chartInstance.current) {
        (chartInstance.current as { remove: () => void }).remove();
      }

      const chart = createChart(chartRef.current, {
        width: chartRef.current.clientWidth,
        height: 320,
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: '#8888a0',
          fontSize: 11,
        },
        grid: {
          vertLines: { color: 'rgba(255,255,255,0.03)' },
          horzLines: { color: 'rgba(255,255,255,0.03)' },
        },
        rightPriceScale: {
          borderColor: 'rgba(255,255,255,0.06)',
        },
        timeScale: {
          borderColor: 'rgba(255,255,255,0.06)',
          timeVisible: true,
        },
        crosshair: {
          horzLine: { color: 'rgba(0,212,255,0.3)', style: LineStyle.Dashed },
          vertLine: { color: 'rgba(0,212,255,0.3)', style: LineStyle.Dashed },
        },
      });

      chartInstance.current = chart;

      // Price line
      const priceSeries = chart.addLineSeries({
        color: '#00d4ff',
        lineWidth: 2,
        priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
        title: 'Price',
      });

      const priceData = data.data
        .filter(d => d.price != null && isFinite(d.price))
        .map(d => ({
          time: Math.floor(new Date(d.ts).getTime() / 1000) as import('lightweight-charts').UTCTimestamp,
          value: d.price,
        }));
      priceSeries.setData(priceData);

      // Confidence line on separate scale
      const confSeries = chart.addLineSeries({
        color: '#a855f7',
        lineWidth: 1,
        priceScaleId: 'confidence',
        priceFormat: {
          type: 'custom',
          formatter: (v: number) => `${v.toFixed(1)}%`,
        },
        title: 'Confidence',
      });

      chart.priceScale('confidence').applyOptions({
        scaleMargins: { top: 0.7, bottom: 0 },
      });

      const confData = data.data
        .filter(d => d.confidence != null && isFinite(d.confidence))
        .map(d => ({
          time: Math.floor(new Date(d.ts).getTime() / 1000) as import('lightweight-charts').UTCTimestamp,
          value: d.confidence * 100,
        }));
      confSeries.setData(confData);

      // Event markers on price line
      if (data.events.length > 0) {
        const markers = data.events.map(e => ({
          time: Math.floor(new Date(e.ts).getTime() / 1000) as import('lightweight-charts').UTCTimestamp,
          position: 'aboveBar' as const,
          color: REGIME_COLORS[REGIME_COLORS[data.data.find(d => d.ts === e.ts)?.regime_id ?? 0] ? data.data.find(d => d.ts === e.ts)?.regime_id ?? 0 : 0] || '#f59e0b',
          shape: 'arrowDown' as const,
          text: e.type === 'TRANSITION' ? `${e.prev_regime} → ${e.regime}` : e.type,
        }));
        priceSeries.setMarkers(markers);
      }

      // Resize handler
      const handleResize = () => {
        if (chartRef.current) {
          chart.applyOptions({ width: chartRef.current.clientWidth });
        }
      };
      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('resize', handleResize);
      };
    });

    return () => {
      cancelled = true;
    };
  }, [data]);

  return (
    <div className="signal-chart-container">
      <div className="chart-header">
        <div className="chart-title">
          <h3>{symbol} Signal</h3>
          {data && data.data.length > 0 && (
            <span
              className="chart-regime-badge"
              style={{ background: REGIME_COLORS[data.data[data.data.length - 1].regime_id] + '20', color: REGIME_COLORS[data.data[data.data.length - 1].regime_id] }}
            >
              {data.data[data.data.length - 1].regime.replace('_', ' ').toUpperCase()}
            </span>
          )}
        </div>
        <div className="chart-range-selector">
          {RANGE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              className={`range-btn ${range === opt.value ? 'active' : ''}`}
              onClick={() => setRange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="chart-placeholder">Loading...</div>}
      {error && <div className="chart-placeholder chart-error">No data available. Signal engine data will appear here once the database is connected.</div>}
      {!loading && !error && data?.data.length === 0 && (
        <div className="chart-placeholder">No data for {symbol} in selected range</div>
      )}

      <div ref={chartRef} className="chart-canvas" />

      <style jsx>{`
        .signal-chart-container {
          background: var(--bg-panel);
          border: 1px solid var(--border-subtle);
          border-radius: 12px;
          overflow: hidden;
        }
        .chart-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .chart-title {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .chart-title h3 {
          font-size: 15px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .chart-regime-badge {
          font-size: 11px;
          font-weight: 700;
          padding: 3px 10px;
          border-radius: 4px;
          letter-spacing: 0.03em;
        }
        .chart-range-selector {
          display: flex;
          gap: 4px;
        }
        .range-btn {
          padding: 5px 12px;
          font-size: 12px;
          font-weight: 600;
          border: 1px solid var(--border-subtle);
          border-radius: 6px;
          background: transparent;
          color: var(--text-secondary);
          cursor: pointer;
          transition: all 0.2s;
        }
        .range-btn:hover {
          border-color: rgba(0,212,255,0.3);
          color: var(--text-primary);
        }
        .range-btn.active {
          background: rgba(0,212,255,0.1);
          border-color: rgba(0,212,255,0.3);
          color: #00d4ff;
        }
        .chart-canvas {
          padding: 8px;
        }
        .chart-placeholder {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 320px;
          color: var(--text-muted);
          font-size: 14px;
        }
        .chart-error {
          color: var(--text-secondary);
          padding: 0 40px;
          text-align: center;
        }
      `}</style>
    </div>
  );
}
