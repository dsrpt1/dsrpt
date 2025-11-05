'use client'
import { useEffect, useMemo, useState } from 'react'
import { runHealthCheck } from '@/lib/health'

type Result = Awaited<ReturnType<typeof runHealthCheck>>
type Color = 'green' | 'amber' | 'red'

const chip = (badge: 'ok' | 'warn' | 'error'): Color =>
  badge === 'ok' ? 'green' : badge === 'warn' ? 'amber' : 'red'

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
    <div className="rounded-2xl border p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Network status</h2>
          <p className="text-sm text-neutral-500">
            {data ? `${data.chain} (chainId ${data.chainId})` : '—'}
          </p>
        </div>
        {loading && <span className="text-sm">checking…</span>}
        {err && <span className="text-sm text-red-600">error</span>}
      </div>

      <div className="divide-y">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center justify-between py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">{r.label}</div>
              <div className="truncate text-xs text-neutral-500">{r.value}</div>
              {r.hint && <div className="mt-1 text-xs text-neutral-500">{r.hint}</div>}
            </div>
            <span
              className={[
                'inline-flex h-7 items-center rounded-full px-3 text-xs font-medium',
                chip(r.badge) === 'green' && 'bg-green-100 text-green-800',
                chip(r.badge) === 'amber' && 'bg-amber-100 text-amber-800',
                chip(r.badge) === 'red' && 'bg-red-100 text-red-800',
              ].filter(Boolean).join(' ')}
            >
              {r.badge === 'ok' ? 'healthy' : r.badge === 'warn' ? 'check' : 'issue'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
