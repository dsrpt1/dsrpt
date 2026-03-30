import { NextRequest, NextResponse } from 'next/server'
import { getDB } from '@/lib/db'

// GET /api/v1/alerts — Recent alerts
// Query params: asset, limit (default 50), since (ISO timestamp)
export async function GET(req: NextRequest) {
  try {
    const sql = getDB()
    const asset = req.nextUrl.searchParams.get('asset')
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '50'), 200)
    const since = req.nextUrl.searchParams.get('since')

    let rows
    if (asset && since) {
      rows = await sql`
        SELECT id, asset, ts, signal_type, regime, prev_regime, confidence,
               price, max_severity, rule_fired, notes, tx_hash
        FROM signal_alerts
        WHERE asset = ${asset.toUpperCase()} AND ts > ${since}
        ORDER BY ts DESC
        LIMIT ${limit}
      `
    } else if (asset) {
      rows = await sql`
        SELECT id, asset, ts, signal_type, regime, prev_regime, confidence,
               price, max_severity, rule_fired, notes, tx_hash
        FROM signal_alerts
        WHERE asset = ${asset.toUpperCase()}
        ORDER BY ts DESC
        LIMIT ${limit}
      `
    } else if (since) {
      rows = await sql`
        SELECT id, asset, ts, signal_type, regime, prev_regime, confidence,
               price, max_severity, rule_fired, notes, tx_hash
        FROM signal_alerts
        WHERE ts > ${since}
        ORDER BY ts DESC
        LIMIT ${limit}
      `
    } else {
      rows = await sql`
        SELECT id, asset, ts, signal_type, regime, prev_regime, confidence,
               price, max_severity, rule_fired, notes, tx_hash
        FROM signal_alerts
        ORDER BY ts DESC
        LIMIT ${limit}
      `
    }

    return NextResponse.json({
      count: rows.length,
      alerts: rows.map(r => ({
        id: r.id,
        asset: r.asset,
        ts: r.ts,
        signal_type: r.signal_type,
        regime: r.regime,
        prev_regime: r.prev_regime,
        confidence: r.confidence,
        price: r.price,
        max_severity: r.max_severity,
        rule_fired: r.rule_fired,
        notes: r.notes,
        tx_hash: r.tx_hash,
      })),
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
