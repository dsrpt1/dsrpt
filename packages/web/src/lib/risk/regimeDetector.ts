// src/lib/risk/regimeDetector.ts
// Automatic market regime detection based on oracle data

import { type Regime } from './hazard';
import { createPublicClient, http, type Address } from 'viem';
import { base } from 'viem/chains';

const ORACLE_ABI = [
  {
    type: 'function',
    name: 'latestPrice',
    stateMutability: 'view',
    inputs: [{ name: 'assetId', type: 'bytes32' }],
    outputs: [
      { name: 'price', type: 'int256' },
      { name: 'updatedAt', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'threshold1e8',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const;

const USDC_ASSET_ID = '0x0000000000000000000000000000000000000000000000000000000000000000' as const;

/**
 * Regime thresholds based on USDC depeg intensity
 * Intensity I = max(0, 1 - USDC/USD price)
 */
const REGIME_THRESHOLDS = {
  // Calm: I < 0.5% (USDC trading > $0.995)
  calm_max: 0.005,
  // Volatile: 0.5% <= I < 2% (USDC between $0.98 - $0.995)
  volatile_max: 0.02,
  // Crisis: I >= 2% (USDC < $0.98)
} as const;

/**
 * Calculate intensity from USDC/USD price
 * I = max(0, 1 - price)
 */
function calculateIntensity(priceUSD: number): number {
  return Math.max(0, 1 - priceUSD);
}

/**
 * Detect market regime from intensity
 */
function intensityToRegime(intensity: number): Regime {
  if (intensity < REGIME_THRESHOLDS.calm_max) {
    return 'calm';
  } else if (intensity < REGIME_THRESHOLDS.volatile_max) {
    return 'volatile';
  } else {
    return 'crisis';
  }
}

/**
 * Fetch current USDC price from on-chain oracle
 */
async function fetchOraclePrice(
  oracleAddress: Address,
  rpcUrl: string
): Promise<{ price: number; updatedAt: number; intensity: number }> {
  const client = createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });

  try {
    const [priceRaw, updatedAt] = (await client.readContract({
      address: oracleAddress,
      abi: ORACLE_ABI,
      functionName: 'latestPrice',
      args: [USDC_ASSET_ID],
    })) as [bigint, bigint];

    // Convert from 1e8 format (Chainlink standard)
    const price = Number(priceRaw) / 1e8;
    const intensity = calculateIntensity(price);

    return {
      price,
      updatedAt: Number(updatedAt),
      intensity,
    };
  } catch (error) {
    console.error('Error fetching oracle price:', error);
    throw new Error('Failed to fetch oracle price');
  }
}

export type RegimeDetectionResult = {
  regime: Regime;
  intensity: number;
  price: number;
  confidence: 'high' | 'medium' | 'low';
  updatedAt: number;
  reason: string;
};

/**
 * Automatically detect current market regime based on on-chain oracle data
 */
export async function detectRegime(
  oracleAddress?: Address,
  rpcUrl?: string
): Promise<RegimeDetectionResult> {
  // Use environment variables with fallbacks
  const oracle =
    oracleAddress ?? (process.env.NEXT_PUBLIC_DEPEG_ADAPTER as Address);
  const rpc =
    rpcUrl ??
    process.env.NEXT_PUBLIC_RPC_URL ??
    process.env.NEXT_PUBLIC_BASE_RPC ??
    'https://mainnet.base.org';

  if (!oracle) {
    // Fallback: default to volatile if no oracle configured
    console.warn('No oracle configured, defaulting to volatile regime');
    return {
      regime: 'volatile',
      intensity: 0.01,
      price: 0.99,
      confidence: 'low',
      updatedAt: Date.now() / 1000,
      reason: 'No oracle configured - using default volatile regime',
    };
  }

  try {
    const { price, updatedAt, intensity } = await fetchOraclePrice(oracle, rpc);

    // Check staleness (if price is > 1 hour old, reduce confidence)
    const now = Date.now() / 1000;
    const ageSeconds = now - updatedAt;
    const isStale = ageSeconds > 3600; // 1 hour

    const regime = intensityToRegime(intensity);

    // Determine confidence based on data freshness and intensity clarity
    let confidence: 'high' | 'medium' | 'low';
    if (isStale) {
      confidence = 'low';
    } else if (
      Math.abs(intensity - REGIME_THRESHOLDS.calm_max) < 0.001 ||
      Math.abs(intensity - REGIME_THRESHOLDS.volatile_max) < 0.005
    ) {
      // Near boundary = lower confidence
      confidence = 'medium';
    } else {
      confidence = 'high';
    }

    const reason = `USDC trading at $${price.toFixed(4)} (${(intensity * 100).toFixed(2)}% depeg intensity)`;

    return {
      regime,
      intensity,
      price,
      confidence,
      updatedAt,
      reason,
    };
  } catch (error) {
    console.error('Regime detection error:', error);
    // Fallback to volatile on error (conservative)
    return {
      regime: 'volatile',
      intensity: 0.01,
      price: 0.99,
      confidence: 'low',
      updatedAt: Date.now() / 1000,
      reason: `Error fetching oracle data: ${error instanceof Error ? error.message : 'Unknown error'}. Defaulting to volatile.`,
    };
  }
}

/**
 * Simple regime detection from current price (for testing/fallback)
 */
export function detectRegimeFromPrice(priceUSD: number): Regime {
  const intensity = calculateIntensity(priceUSD);
  return intensityToRegime(intensity);
}
