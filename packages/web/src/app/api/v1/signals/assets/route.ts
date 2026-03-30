import { NextRequest, NextResponse } from 'next/server'
import { getDB } from '@/lib/db'

// GET /api/v1/signals/assets — All tracked assets with current signal
// GET /api/v1/signals/assets?symbol=USDC — Single asset detail
export async function GET(req: NextRequest) {
  try {
    const sql = getDB()
    const symbol = req.nextUrl.searchParams.get('symbol')

    if (symbol) {
      // Single asset: latest tick + recent history
      const [latest] = await sql`
        SELECT asset, ts, price, regime, regime_id, confidence,
               escalation, premium_mult, peg_dev_bps, max_severity, partial_scores
        FROM signal_ticks
        WHERE asset = ${symbol.toUpperCase()}
        ORDER BY ts DESC
        LIMIT 1
      `

      if (!latest) {
        return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
      }

      // Last 24h of ticks for sparkline
      const recent = await sql`
        SELECT ts, price, regime, regime_id, confidence, peg_dev_bps, max_severity
        FROM signal_ticks
        WHERE asset = ${symbol.toUpperCase()}
          AND ts > NOW() - INTERVAL '24 hours'
        ORDER BY ts ASC
      `

      return NextResponse.json({
        asset: latest.asset,
        updated_at: latest.ts,
        price: latest.price,
        regime: latest.regime,
        regime_id: latest.regime_id,
        confidence: latest.confidence,
        escalation: latest.escalation,
        premium_multiplier_bps: latest.premium_mult,
        peg_dev_bps: latest.peg_dev_bps,
        max_severity: latest.max_severity,
        partial_scores: latest.partial_scores,
        recent: recent.map(r => ({
          ts: r.ts,
          price: r.price,
          regime: r.regime,
          confidence: r.confidence,
          peg_dev_bps: r.peg_dev_bps,
        })),
      })
    }

    // All assets: latest tick per asset
    const rows = await sql`
      SELECT DISTINCT ON (asset)
        asset, ts, price, regime, regime_id, confidence,
        escalation, premium_mult, peg_dev_bps, max_severity
      FROM signal_ticks
      ORDER BY asset, ts DESC
    `

    return NextResponse.json({
      assets: rows.map(r => ({
        asset: r.asset,
        updated_at: r.ts,
        price: r.price,
        regime: r.regime,
        regime_id: r.regime_id,
        confidence: r.confidence,
        escalation: r.escalation,
        premium_multiplier_bps: r.premium_mult,
        peg_dev_bps: r.peg_dev_bps,
        max_severity: r.max_severity,
      })),
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
