'use client'
import { useEffect, useMemo, useState } from 'react'
import { runHealthCheck } from '@/lib/health'

type Result = Awaited<ReturnType<typeof runHealthCheck>>

const badgeClass = (badge: 'ok' | 'warn' | 'error') =>
  badge === 'ok' ? 'badge-green' : badge === 'warn' ? 'badge-amber' : 'badge-red'

export default function NetworkStatus() {
  const [data, setData] = useState<Result | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const loading = !data && !err

  useEffect(() => {
    let on = true
    runHealthCheck()
      .then((r) => on && setData(r))
      .catch((e) => on && setErr(String(e)))
    return () => { on = false }
  }, [])

  const rows = useMemo(() => data?.rows ?? [], [data])

  return (
    <div
      className="card"
      style={{
        padding: 24,
        gridColumn: 'span 1',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: 'linear-gradient(135deg, rgba(0, 212, 255, 0.2) 0%, rgba(34, 197, 94, 0.2) 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
            }}
          >
            🌐
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Network Status</h2>
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
              {data ? `${data.chain} (chainId ${data.chainId})` : '—'}
            </p>
          </div>
        </div>
        {loading && (
          <div
            className="loading-shimmer"
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              fontSize: 13,
              color: 'var(--accent-cyan)',
            }}
          >
            checking...
          </div>
        )}
        {err && (
          <span
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              fontSize: 13,
              background: 'rgba(239, 68, 68, 0.1)',
              color: '#f87171',
              border: '1px solid rgba(239, 68, 68, 0.3)',
            }}
          >
            error
          </span>
        )}
      </div>

      {/* Status Rows */}
      <div style={{ display: 'grid', gap: 2 }}>
        {rows.map((r, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 0',
              borderBottom: i < rows.length - 1 ? '1px solid rgba(255, 255, 255, 0.05)' : 'none',
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
                {r.label}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  marginTop: 2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '220px',
                }}
                title={r.value}
              >
                {r.value}
              </div>
              {r.hint && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  {r.hint}
                </div>
              )}
            </div>
            <span
              className={badgeClass(r.badge)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                height: 28,
                padding: '0 12px',
                borderRadius: 14,
                fontSize: 12,
                fontWeight: 500,
                marginLeft: 12,
                flexShrink: 0,
              }}
            >
              {r.badge === 'ok' ? 'healthy' : r.badge === 'warn' ? 'check' : 'issue'}
            </span>
          </div>
        ))}
      </div>

      {/* Empty state */}
      {!loading && rows.length === 0 && !err && (
        <div
          style={{
            textAlign: 'center',
            padding: 32,
            color: 'var(--text-secondary)',
            fontSize: 14,
          }}
        >
          No status data available
        </div>
      )}
    </div>
  )
}
