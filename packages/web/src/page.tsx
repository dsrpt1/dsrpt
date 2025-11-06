'use client'

import Header from '@/components/header'
import { useReadContract } from 'wagmi'
import { formatUnits } from 'viem'
import { aggregatorV3Abi } from '@/abis/aggregatorV3'
import { erc20Abi } from '@/abis/erc20'
import { policyManagerAbi } from '@/abis/policyManager'
import { useMemo } from 'react'

const FEED = process.env.NEXT_PUBLIC_CHAINLINK_USDC_USD as `0x${string}`
const USDC = process.env.NEXT_PUBLIC_USDC as `0x${string}`
const POOL = process.env.NEXT_PUBLIC_LIQUIDITY_POOL as `0x${string}`
const PM   = process.env.NEXT_PUBLIC_POLICY_MANAGER as `0x${string}`

// Chainlink latestRoundData typically returns:
// (roundId, answer, startedAt, updatedAt, answeredInRound)
// We'll type it so we don't need `any`.
type LatestRoundData = readonly [bigint, bigint, bigint, bigint, bigint]

export default function Page() {
  // const { address } = useAccount() // not used yet, so remove to satisfy eslint

  const { data: round } = useReadContract({
    address: FEED,
    abi: aggregatorV3Abi,
    functionName: 'latestRoundData',
    query: { enabled: !!FEED },
  })

  const { data: priceDecimals } = useReadContract({
    address: FEED,
    abi: aggregatorV3Abi,
    functionName: 'decimals',
    query: { enabled: !!FEED },
  })

  const { data: poolUsdcbal } = useReadContract({
    address: USDC,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: POOL ? [POOL] : undefined,
    query: { enabled: !!POOL && !!USDC },
  })

  const { data: usdcDecimals } = useReadContract({
    address: USDC,
    abi: erc20Abi,
    functionName: 'decimals',
    query: { enabled: !!USDC },
  })

  const { data: usdcSymbol } = useReadContract({
    address: USDC,
    abi: erc20Abi,
    functionName: 'symbol',
    query: { enabled: !!USDC },
  })

  const { data: oracleAddr } = useReadContract({
    address: PM,
    abi: policyManagerAbi,
    functionName: 'oracle',
    query: { enabled: !!PM },
  })

  const price = useMemo(() => {
    if (!round || priceDecimals == null) return undefined

    // round is the tuple from Chainlink
    const tuple = round as LatestRoundData
    const answer = tuple[1] // index 1 = answer
    return Number(formatUnits(answer, Number(priceDecimals)))
  }, [round, priceDecimals])

  const poolBalance = useMemo(() => {
    if (poolUsdcbal == null || usdcDecimals == null) return undefined
    return Number(formatUnits(poolUsdcbal as bigint, Number(usdcDecimals)))
  }, [poolUsdcbal, usdcDecimals])

  return (
    <div className="min-h-screen">
      <Header />
      <main className="max-w-4xl mx-auto p-4 space-y-6">
        <section className="border rounded-2xl p-4">
          <h2 className="text-xl font-semibold mb-2">Oracle status</h2>
          <div>Feed (USDC/USD): {FEED || '—'}</div>
          <div>Latest price: {price !== undefined ? `${price} USD` : '…'}</div>
          <div>PolicyManager: {PM || '—'}</div>
          <div>Oracle (from PM): {(oracleAddr as string) || '…'}</div>
        </section>

        <section className="border rounded-2xl p-4">
          <h2 className="text-xl font-semibold mb-2">Pool</h2>
          <div>Pool address: {POOL || '—'}</div>
          <div>
            Asset: {USDC} {usdcSymbol ? `(${usdcSymbol as string})` : ''}
          </div>
          <div>USDC balance: {poolBalance !== undefined ? poolBalance : '…'}</div>
        </section>

        <section className="border rounded-2xl p-4">
          <h2 className="text-xl font-semibold mb-2">Buy Policy (disabled until deploy)</h2>
          <p className="text-sm opacity-70">
            We’ll enable this after contracts are live & addresses are set. For now, UI is wired read-only.
          </p>
          <button
            disabled
            className="mt-3 rounded-xl border px-4 py-2 opacity-50 cursor-not-allowed"
            title="Contracts not yet deployed"
          >
            Purchase
          </button>
        </section>
      </main>
    </div>
  )
}
