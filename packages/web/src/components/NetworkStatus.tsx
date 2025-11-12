'use client'
import { useEffect, useMemo, useState } from 'react'
import { runHealthCheck } from '@/lib/health'
import CyberCard from './CyberCard'
import StatusBadge from './StatusBadge'
import RateLimitAlert from './RateLimitAlert'

type Result = Awaited<ReturnType<typeof runHealthCheck>>
type BadgeType = 'ok' | 'warn' | 'error'

export default function NetworkStatus() {
  const [data, setData] = useState<Result | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [showRateLimitAlert, setShowRateLimitAlert] = useState(false)
  const loading = !data && !err

  useEffect(() => {
    let on = true
    runHealthCheck()
      .then((r) => on && setData(r))
      .catch((e) => {
        if (on) {
          const errorMsg = String(e)
          setErr(errorMsg)
          // Check if it's a rate limit error
          if (errorMsg.includes('rate limit') || errorMsg.includes('429')) {
            setShowRateLimitAlert(true)
          }
        }
      })
    return () => { on = false }
  }, [])

  const rows = useMemo(() => data?.rows ?? [], [data])

  return (
    <>
      <RateLimitAlert
        show={showRateLimitAlert}
        onClose={() => setShowRateLimitAlert(false)}
      />
    <CyberCard scan={loading}>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-dsrpt-cyan-primary text-glow uppercase tracking-wider">
            Network Status
          </h2>
          <p className="text-sm text-dsrpt-cyan-secondary mt-1 font-mono">
            {data ? `${data.chain} // chainId ${data.chainId}` : 'INITIALIZING...'}
          </p>
        </div>
        {loading && (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-dsrpt-cyan-primary rounded-full animate-pulse" />
            <span className="text-sm text-dsrpt-cyan-secondary uppercase tracking-wider">
              SCANNING
            </span>
          </div>
        )}
        {err && (
          <span className="text-sm text-dsrpt-danger uppercase tracking-wider font-bold">
            ERROR
          </span>
        )}
      </div>

      <div className="space-y-4">
        {rows.map((r, i) => (
          <div
            key={i}
            className="flex items-center justify-between py-4 border-b border-dsrpt-cyan-primary/10 last:border-0 hover:bg-dsrpt-gray-800/50 transition-all duration-300 px-4 -mx-4"
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-dsrpt-cyan-primary uppercase tracking-wider mb-1">
                {r.label}
              </div>
              <div className="truncate text-xs text-dsrpt-cyan-secondary font-mono">
                {r.value}
              </div>
              {r.hint && (
                <div className="mt-2 text-xs text-dsrpt-cyan-dark font-mono">
                  {'//'} {r.hint}
                </div>
              )}
            </div>
            <StatusBadge status={r.badge as BadgeType} />
          </div>
        ))}
      </div>

      {data && (
        <div className="mt-6 pt-4 border-t border-dsrpt-cyan-primary/20">
          <div className="text-xs text-dsrpt-cyan-dark font-mono text-center">
            LAST CHECK: {new Date().toLocaleTimeString()} UTC
          </div>
        </div>
      )}
    </CyberCard>
    </>
  )
}
