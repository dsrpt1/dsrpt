import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

const policyManagerAbi = [
  {
    type: 'function',
    name: 'policies',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [
      { name: 'buyer', type: 'address' },
      { name: 'payout', type: 'uint256' },
      { name: 'premium', type: 'uint256' },
      { name: 'startTs', type: 'uint256' },
      { name: 'endTs', type: 'uint256' },
      { name: 'resolved', type: 'bool' }
    ]
  }
] as const;

const POLICY_MANAGER = process.env.NEXT_PUBLIC_POLICY_MANAGER as `0x${string}`;
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://mainnet.base.org';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const policyId = parseInt(params.id);

    if (isNaN(policyId) || policyId < 1) {
      return NextResponse.json(
        { success: false, error: 'Invalid policy ID' },
        { status: 400 }
      );
    }

    const client = createPublicClient({
      chain: base,
      transport: http(RPC_URL),
    });

    const policy = await client.readContract({
      address: POLICY_MANAGER,
      abi: policyManagerAbi,
      functionName: 'policies',
      args: [BigInt(policyId)],
    });

    return NextResponse.json({
      success: true,
      buyer: policy[0],
      payout: policy[1].toString(),
      premium: policy[2].toString(),
      startTs: policy[3].toString(),
      endTs: policy[4].toString(),
      resolved: policy[5],
    });
  } catch (error: any) {
    console.error('Error fetching policy:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch policy' },
      { status: 500 }
    );
  }
}
