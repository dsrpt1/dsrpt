import { NextResponse } from 'next/server'
import { getDB } from '@/lib/db'

// GET /api/v1/signals/market — Market-wide composite signal
export async function GET() {
  try {
    const sql = getDB()

    // Get latest tick per asset
    const rows = await sql`
      SELECT DISTINCT ON (asset)
        asset, ts, price, regime, regime_id, confidence,
        escalation, premium_mult, peg_dev_bps, max_severity, partial_scores
      FROM signal_ticks
      ORDER BY asset, ts DESC
    `

    const assets = rows.map(r => ({
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
      partial_scores: r.partial_scores,
    }))

    // Composite: highest severity regime across all assets
    const worst = assets.reduce((a, b) => (b.regime_id > a.regime_id ? b : a), assets[0])

    return NextResponse.json({
      composite_regime: worst?.regime ?? 'unknown',
      composite_regime_id: worst?.regime_id ?? 0,
      assets_on_alert: assets.filter(a => a.escalation >= 2).length,
      total_assets: assets.length,
      updated_at: worst?.updated_at ?? null,
      assets,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
