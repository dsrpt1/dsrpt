// src/app/api/quote/route.ts
// API endpoint for actuarial premium calculation

import { NextRequest, NextResponse } from 'next/server';
import { pricePolicy, validateQuoteInput, type QuoteInput, type PriceBreakdown } from '@/lib/risk/price';
import { type PerilSpec } from '@/lib/risk/hazard';
import { detectRegime, type RegimeDetectionResult } from '@/lib/risk/regimeDetector';
import usdcDepegPeril from '@/config/perils/usdc-depeg.json';

// Type-safe peril loading
const PERILS: Record<string, PerilSpec> = {
  'usdc-depeg': usdcDepegPeril as PerilSpec,
};

export type QuoteRequest = {
  peril_id: string;
  limit_usd: number;
  tenor_days: number;
  attachment_pct?: number;
  portfolio?: {
    utilization?: number;
    tvar99_headroom_usd?: number;
  };
};

export type QuoteResponse =
  | {
      success: true;
      quote: PriceBreakdown;
      regime_detection: RegimeDetectionResult;
      request: QuoteRequest;
    }
  | {
      success: false;
      error: string;
    };

/**
 * POST /api/quote
 *
 * Request body:
 * {
 *   "peril_id": "usdc-depeg",
 *   "limit_usd": 1000000,
 *   "tenor_days": 30,
 *   "attachment_pct": 0,
 *   "portfolio": {
 *     "utilization": 0.5,
 *     "tvar99_headroom_usd": 10000000
 *   }
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "quote": {
 *     "EL": 20350.45,
 *     "RL": 24935.12,
 *     "CL": 0,
 *     "LL": 7200.00,
 *     "O_H": 1570.23,
 *     "MTM": 8115.84,
 *     "premium": 62171.64,
 *     "utilization_after": 0.505,
 *     "metadata": { ... }
 *   },
 *   "regime_detection": {
 *     "regime": "volatile",
 *     "intensity": 0.0123,
 *     "price": 0.9877,
 *     "confidence": "high",
 *     "reason": "USDC trading at $0.9877 (1.23% depeg intensity)"
 *   }
 * }
 */
export async function POST(request: NextRequest): Promise<NextResponse<QuoteResponse>> {
  try {
    const body: QuoteRequest = await request.json();

    // Validate request
    if (!body.peril_id || !PERILS[body.peril_id]) {
      return NextResponse.json(
        {
          success: false,
          error: `Unknown peril: ${body.peril_id}. Available: ${Object.keys(PERILS).join(', ')}`,
        },
        { status: 400 }
      );
    }

    if (!body.limit_usd || body.limit_usd <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'limit_usd must be positive',
        },
        { status: 400 }
      );
    }

    if (!body.tenor_days || body.tenor_days <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'tenor_days must be positive',
        },
        { status: 400 }
      );
    }

    // AUTOMATIC REGIME DETECTION from on-chain oracle
    const regimeDetection = await detectRegime();

    // Build quote input
    const peril = PERILS[body.peril_id];
    const quoteInput: QuoteInput = {
      perilId: body.peril_id,
      regime: regimeDetection.regime, // Auto-detected, not user-provided
      notionalUSD: body.limit_usd,
      attachmentPct: body.attachment_pct ?? 0,
      limitUSD: body.limit_usd,
      tenorDays: body.tenor_days,
      portfolio: {
        utilization: body.portfolio?.utilization ?? 0.5,
        tvar99_headroom_usd: body.portfolio?.tvar99_headroom_usd ?? body.limit_usd * 10,
      },
      curve: peril,
    };

    // Validate
    const validationError = validateQuoteInput(quoteInput);
    if (validationError) {
      return NextResponse.json(
        {
          success: false,
          error: validationError,
        },
        { status: 400 }
      );
    }

    // Price the policy
    const quote = pricePolicy(quoteInput);

    return NextResponse.json({
      success: true,
      quote,
      regime_detection: regimeDetection,
      request: body,
    });
  } catch (error) {
    console.error('Error pricing policy:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/quote?peril_id=usdc-depeg
 * Returns peril configuration details
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const searchParams = request.nextUrl.searchParams;
  const perilId = searchParams.get('peril_id');

  if (perilId) {
    const peril = PERILS[perilId];
    if (!peril) {
      return NextResponse.json(
        {
          success: false,
          error: `Unknown peril: ${perilId}`,
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      peril,
    });
  }

  // List all available perils
  return NextResponse.json({
    success: true,
    perils: Object.keys(PERILS),
    details: PERILS,
  });
}
