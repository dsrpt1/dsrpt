// src/app/api/test-oracle/route.ts
// Test endpoint for debugging oracle connectivity

import { NextRequest, NextResponse } from 'next/server';
import { detectRegime } from '@/lib/risk/regimeDetector';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const searchParams = request.nextUrl.searchParams;
  const oracle = searchParams.get('oracle');
  const rpc = searchParams.get('rpc');

  console.log('Test oracle endpoint called');
  console.log('Oracle address:', oracle ?? process.env.NEXT_PUBLIC_DEPEG_ADAPTER);
  console.log('RPC URL:', rpc ?? process.env.NEXT_PUBLIC_RPC_URL);

  try {
    const start = Date.now();
    const result = await detectRegime(
      oracle as `0x${string}` | undefined,
      rpc ?? undefined
    );
    const duration = Date.now() - start;

    return NextResponse.json({
      success: true,
      result,
      duration_ms: duration,
      env: {
        oracle: process.env.NEXT_PUBLIC_DEPEG_ADAPTER,
        rpc: process.env.NEXT_PUBLIC_RPC_URL?.substring(0, 50) + '...',
      },
    });
  } catch (error) {
    console.error('Test oracle error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      env: {
        oracle: process.env.NEXT_PUBLIC_DEPEG_ADAPTER,
        rpc: process.env.NEXT_PUBLIC_RPC_URL?.substring(0, 50) + '...',
      },
    });
  }
}
