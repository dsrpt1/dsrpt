'use client'
import { useState } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi'
import { parseUnits, formatUnits, keccak256, toHex } from 'viem'
import { ADDRESSES } from '@/lib/addresses'
import { POLICY_MANAGER_ABI, HAZARD_CURVE_ABI } from '@/lib/abis'

type Props = {
  isOpen: boolean
  onClose: () => void
}

const DURATION_OPTIONS = [
  { label: '7 days', value: 7, seconds: 7 * 24 * 60 * 60 },
  { label: '14 days', value: 14, seconds: 14 * 24 * 60 * 60 },
  { label: '30 days', value: 30, seconds: 30 * 24 * 60 * 60 },
]

// Default curve ID for USDC depeg protection
const USDC_CURVE_ID = keccak256(toHex('USDC_DEPEG'))

export default function CreatePolicyModal({ isOpen, onClose }: Props) {
  const [payout, setPayout] = useState('')
  const [duration, setDuration] = useState(DURATION_OPTIONS[0])
  const { address } = useAccount()
  const A = ADDRESSES.base

  // Calculate coverage in base units (6 decimals for USDC)
  const coverageBn = payout ? parseUnits(payout, 6) : BigInt(0)

  // Fetch premium from HazardCurveEngine
  const { data: calculatedPremium, isLoading: premiumLoading } = useReadContract({
    address: A.curve as `0x${string}`,
    abi: HAZARD_CURVE_ABI,
    functionName: 'premiumOf',
    args: [USDC_CURVE_ID, coverageBn, BigInt(duration.value)],
    query: { enabled: coverageBn > 0 },
  })

  // Fetch curve parameters for display
  const { data: curveParams } = useReadContract({
    address: A.curve as `0x${string}`,
    abi: HAZARD_CURVE_ABI,
    functionName: 'curves',
    args: [USDC_CURVE_ID],
  })

  // Format premium for display
  const premiumFormatted = calculatedPremium ? formatUnits(calculatedPremium, 6) : '0'
  const premiumBps = curveParams ? Number(curveParams[2]) : 0 // minPremiumBps

  // Create policy transaction
  const { writeContract, data: txHash, isPending } = useWriteContract()
  const { isLoading: waiting, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  const handleCreate = () => {
    if (!calculatedPremium || !payout) return
    writeContract({
      address: A.pm as `0x${string}`,
      abi: POLICY_MANAGER_ABI,
      functionName: 'createPolicy',
      args: [
        calculatedPremium,        // premium from curve
        coverageBn,               // payout in USDC (6 decimals)
        BigInt(duration.seconds),
      ],
    })
  }

  const handleClose = () => {
    setPayout('')
    setDuration(DURATION_OPTIONS[0])
    onClose()
  }

  if (!isOpen) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.8)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={handleClose}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: 420,
          padding: 24,
          margin: 16,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Create Protection Policy</h2>
          <button
            onClick={handleClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              fontSize: 24,
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        {isSuccess ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🛡️</div>
            <div style={{ color: '#4ade80', fontSize: 18, marginBottom: 8 }}>Policy Created!</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
              Your depeg protection is now active
            </div>
            <div style={{ marginTop: 16, padding: 16, background: 'rgba(0,0,0,0.2)', borderRadius: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Coverage</span>
                <span style={{ color: 'var(--text-primary)', fontSize: 13 }}>{payout} USDC</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Premium Paid</span>
                <span style={{ color: 'var(--text-primary)', fontSize: 13 }}>{premiumFormatted} USDC</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Duration</span>
                <span style={{ color: 'var(--text-primary)', fontSize: 13 }}>{duration.label}</span>
              </div>
            </div>
            <button
              onClick={handleClose}
              style={{
                marginTop: 24,
                padding: '12px 32px',
                background: 'linear-gradient(135deg, #00d4ff 0%, #a855f7 100%)',
                border: 'none',
                borderRadius: 12,
                color: '#fff',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Done
            </button>
          </div>
        ) : (
          <>
            {/* Coverage Amount */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 8, color: 'var(--text-secondary)', fontSize: 13 }}>
                Coverage Amount (USDC)
              </label>
              <input
                type="number"
                value={payout}
                onChange={(e) => setPayout(e.target.value)}
                placeholder="1000"
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid rgba(0, 212, 255, 0.2)',
                  borderRadius: 12,
                  color: 'var(--text-primary)',
                  fontSize: 16,
                  outline: 'none',
                }}
              />
              <div style={{ marginTop: 6, color: 'var(--text-muted)', fontSize: 12 }}>
                Amount you&apos;ll receive if USDC depegs below threshold
              </div>
            </div>

            {/* Duration */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', marginBottom: 8, color: 'var(--text-secondary)', fontSize: 13 }}>
                Duration
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {DURATION_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setDuration(opt)}
                    style={{
                      flex: 1,
                      padding: '12px',
                      background: duration.value === opt.value
                        ? 'rgba(0, 212, 255, 0.2)'
                        : 'rgba(0, 0, 0, 0.2)',
                      border: duration.value === opt.value
                        ? '1px solid rgba(0, 212, 255, 0.5)'
                        : '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: 8,
                      color: duration.value === opt.value ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                      fontSize: 14,
                      cursor: 'pointer',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Premium Display - Calculated from Hazard Curve */}
            <div style={{
              marginBottom: 20,
              padding: 16,
              background: 'linear-gradient(135deg, rgba(0, 212, 255, 0.08) 0%, rgba(168, 85, 247, 0.08) 100%)',
              border: '1px solid rgba(0, 212, 255, 0.2)',
              borderRadius: 12,
            }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                Risk-Based Premium
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div>
                  {premiumLoading ? (
                    <span style={{ color: 'var(--text-secondary)' }}>Calculating...</span>
                  ) : payout ? (
                    <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--accent-cyan)' }}>
                      {premiumFormatted} USDC
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-secondary)' }}>Enter coverage amount</span>
                  )}
                </div>
                {premiumBps > 0 && payout && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {(premiumBps / 100).toFixed(2)}% of coverage
                  </div>
                )}
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                Premium calculated from hazard curve based on risk parameters
              </div>
            </div>

            {/* Summary */}
            {payout && calculatedPremium && (
              <div style={{
                marginBottom: 20,
                padding: 16,
                background: 'rgba(0, 0, 0, 0.2)',
                borderRadius: 12,
              }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>Summary</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: 'var(--text-muted)' }}>You pay</span>
                  <span style={{ color: 'var(--accent-purple)' }}>{premiumFormatted} USDC</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: 'var(--text-muted)' }}>You receive if depeg</span>
                  <span style={{ color: 'var(--accent-cyan)' }}>{payout} USDC</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Protection period</span>
                  <span style={{ color: 'var(--text-primary)' }}>{duration.label}</span>
                </div>
              </div>
            )}

            <button
              onClick={handleCreate}
              disabled={!calculatedPremium || !payout || isPending || waiting}
              style={{
                width: '100%',
                padding: '14px',
                background: isPending || waiting
                  ? 'rgba(0, 212, 255, 0.3)'
                  : 'linear-gradient(135deg, #00d4ff 0%, #a855f7 100%)',
                border: 'none',
                borderRadius: 12,
                color: '#fff',
                fontSize: 16,
                fontWeight: 600,
                cursor: isPending || waiting ? 'wait' : 'pointer',
                opacity: (!calculatedPremium || !payout) ? 0.5 : 1,
              }}
            >
              {isPending || waiting ? 'Creating Policy...' : 'Create Policy'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
