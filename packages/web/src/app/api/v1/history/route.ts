import { NextRequest, NextResponse } from 'next/server'
import { getDB } from '@/lib/db'

// GET /api/v1/history?symbol=USDC — Historical time series
// Query params: symbol (required), range (1d/7d/30d/90d, default 7d)
export async function GET(req: NextRequest) {
  try {
    const sql = getDB()
    const symbol = req.nextUrl.searchParams.get('symbol')
    const range = req.nextUrl.searchParams.get('range') || '7d'

    if (!symbol) {
      return NextResponse.json({ error: 'symbol parameter required' }, { status: 400 })
    }

    const intervalMap: Record<string, string> = {
      '1d': '1 day',
      '7d': '7 days',
      '30d': '30 days',
      '90d': '90 days',
    }
    const interval = intervalMap[range] || '7 days'

    const rows = await sql`
      SELECT ts, price, regime, regime_id, confidence,
             escalation, premium_mult, peg_dev_bps, max_severity
      FROM signal_ticks
      WHERE asset = ${symbol.toUpperCase()}
        AND ts > NOW() - ${interval}::interval
      ORDER BY ts ASC
    `

    // Also get alerts in the same range for event markers
    const alerts = await sql`
      SELECT ts, signal_type, regime, prev_regime, confidence, price
      FROM signal_alerts
      WHERE asset = ${symbol.toUpperCase()}
        AND ts > NOW() - ${interval}::interval
      ORDER BY ts ASC
    `

    return NextResponse.json({
      asset: symbol.toUpperCase(),
      range,
      count: rows.length,
      data: rows.map(r => ({
        ts: r.ts,
        price: r.price,
        regime: r.regime,
        regime_id: r.regime_id,
        confidence: r.confidence,
        escalation: r.escalation,
        premium_multiplier_bps: r.premium_mult,
        peg_dev_bps: r.peg_dev_bps,
        max_severity: r.max_severity,
      })),
      events: alerts.map(a => ({
        ts: a.ts,
        type: a.signal_type,
        regime: a.regime,
        prev_regime: a.prev_regime,
        confidence: a.confidence,
        price: a.price,
      })),
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
