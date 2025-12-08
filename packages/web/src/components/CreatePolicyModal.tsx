'use client'
import { useState } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi'
import { parseUnits, formatUnits } from 'viem'
import { ADDRESSES, PERIL_IDS } from '@/lib/addresses'
import { POLICY_MANAGER_ABI, HAZARD_ENGINE_ABI, ERC20_ABI } from '@/lib/abis'

type Props = {
  isOpen: boolean
  onClose: () => void
}

const DURATION_OPTIONS = [
  { label: '7 days', value: 7 },
  { label: '14 days', value: 14 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
]

// Regime labels for display
const REGIME_LABELS = ['Calm', 'Volatile', 'Crisis'] as const

// Fallback premium rate in basis points (5% = 500 bps) when engine not initialized
const FALLBACK_PREMIUM_BPS = 500n

export default function CreatePolicyModal({ isOpen, onClose }: Props) {
  const [coverage, setCoverage] = useState('')
  const [duration, setDuration] = useState(DURATION_OPTIONS[0])
  const [step, setStep] = useState<'input' | 'approve' | 'create'>('input')
  const { address } = useAccount()
  const A = ADDRESSES.base

  // Calculate coverage in base units (6 decimals for USDC)
  const coverageBn = coverage ? parseUnits(coverage, 6) : 0n

  // Fetch premium from HazardEngine using new interface
  // quotePremium(perilId, tenorDays, limitUSD)
  const { data: calculatedPremium, isLoading: premiumLoading } = useReadContract({
    address: A.hazardEngine as `0x${string}`,
    abi: HAZARD_ENGINE_ABI,
    functionName: 'quotePremium',
    args: [PERIL_IDS.USDC_DEPEG as `0x${string}`, BigInt(duration.value), coverageBn],
    query: { enabled: coverageBn > 0n },
  })

  // Fetch current regime for display
  const { data: currentRegime } = useReadContract({
    address: A.hazardEngine as `0x${string}`,
    abi: HAZARD_ENGINE_ABI,
    functionName: 'getCurrentRegime',
    args: [PERIL_IDS.USDC_DEPEG as `0x${string}`],
  })

  // Check USDC allowance for PolicyManager
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: A.usdc as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, A.policyManager as `0x${string}`] : undefined,
    query: { enabled: !!address },
  })

  // Use contract premium if available, otherwise fallback
  const effectivePremium = (() => {
    if (!coverageBn || coverageBn === 0n) return 0n
    if (calculatedPremium && calculatedPremium > 0n) {
      return calculatedPremium
    }
    // Fallback: 5% of coverage
    return (coverageBn * FALLBACK_PREMIUM_BPS) / 10000n
  })()

  const usingFallback = !calculatedPremium && coverageBn > 0n
  const needsApproval = allowance !== undefined && effectivePremium > allowance

  // Approve USDC
  const { writeContract: approve, data: approveTx, isPending: approving } = useWriteContract()
  const { isLoading: waitingApprove, isSuccess: approveSuccess } = useWaitForTransactionReceipt({
    hash: approveTx,
  })

  // Issue policy transaction
  const { writeContract: issuePolicy, data: policyTx, isPending: issuingPolicy } = useWriteContract()
  const { isLoading: waitingPolicy, isSuccess: policySuccess } = useWaitForTransactionReceipt({
    hash: policyTx,
  })

  // Refetch allowance after approval
  if (approveSuccess && step === 'approve') {
    refetchAllowance()
    setStep('create')
  }

  const handleApprove = () => {
    if (!effectivePremium) return
    setStep('approve')
    approve({
      address: A.usdc as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [A.policyManager as `0x${string}`, effectivePremium],
    })
  }

  const handleCreate = () => {
    if (!effectivePremium || !coverage || !address) return
    setStep('create')
    issuePolicy({
      address: A.policyManager as `0x${string}`,
      abi: POLICY_MANAGER_ABI,
      functionName: 'issueFixedPolicy',
      args: [
        PERIL_IDS.USDC_DEPEG as `0x${string}`,
        address,
        coverageBn,
        duration.value,
      ],
    })
  }

  const handleClose = () => {
    setCoverage('')
    setDuration(DURATION_OPTIONS[0])
    setStep('input')
    onClose()
  }

  // Format premium for display
  const premiumFormatted = effectivePremium > 0n ? formatUnits(effectivePremium, 6) : '0'
  const premiumPercent = coverageBn > 0n
    ? ((Number(effectivePremium) / Number(coverageBn)) * 100).toFixed(2)
    : '0'

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
          maxWidth: 440,
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

        {policySuccess ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🛡️</div>
            <div style={{ color: '#4ade80', fontSize: 18, marginBottom: 8 }}>Policy Created!</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
              Your depeg protection is now active
            </div>
            <div style={{ marginTop: 16, padding: 16, background: 'rgba(0,0,0,0.2)', borderRadius: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Coverage</span>
                <span style={{ color: 'var(--text-primary)', fontSize: 13 }}>{coverage} USDC</span>
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
            {/* Current Regime Indicator */}
            {currentRegime !== undefined && (
              <div style={{
                marginBottom: 16,
                padding: '8px 12px',
                background: currentRegime === 0
                  ? 'rgba(34, 197, 94, 0.1)'
                  : currentRegime === 1
                    ? 'rgba(251, 191, 36, 0.1)'
                    : 'rgba(239, 68, 68, 0.1)',
                border: `1px solid ${currentRegime === 0
                  ? 'rgba(34, 197, 94, 0.3)'
                  : currentRegime === 1
                    ? 'rgba(251, 191, 36, 0.3)'
                    : 'rgba(239, 68, 68, 0.3)'}`,
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                <span style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: currentRegime === 0 ? '#22c55e' : currentRegime === 1 ? '#fbbf24' : '#ef4444',
                }} />
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  Market Regime: <strong style={{ color: 'var(--text-primary)' }}>{REGIME_LABELS[currentRegime] || 'Unknown'}</strong>
                </span>
              </div>
            )}

            {/* Coverage Amount */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 8, color: 'var(--text-secondary)', fontSize: 13 }}>
                Coverage Amount (USDC)
              </label>
              <input
                type="number"
                value={coverage}
                onChange={(e) => setCoverage(e.target.value)}
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
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {DURATION_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setDuration(opt)}
                    style={{
                      padding: '12px 8px',
                      background: duration.value === opt.value
                        ? 'rgba(0, 212, 255, 0.2)'
                        : 'rgba(0, 0, 0, 0.2)',
                      border: duration.value === opt.value
                        ? '1px solid rgba(0, 212, 255, 0.5)'
                        : '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: 8,
                      color: duration.value === opt.value ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Premium Display */}
            <div style={{
              marginBottom: 20,
              padding: 16,
              background: usingFallback
                ? 'linear-gradient(135deg, rgba(251, 191, 36, 0.08) 0%, rgba(245, 158, 11, 0.08) 100%)'
                : 'linear-gradient(135deg, rgba(0, 212, 255, 0.08) 0%, rgba(168, 85, 247, 0.08) 100%)',
              border: usingFallback
                ? '1px solid rgba(251, 191, 36, 0.3)'
                : '1px solid rgba(0, 212, 255, 0.2)',
              borderRadius: 12,
            }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                {usingFallback ? 'Default Premium Rate' : 'Risk-Based Premium'}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div>
                  {premiumLoading ? (
                    <span style={{ color: 'var(--text-secondary)' }}>Calculating...</span>
                  ) : coverage ? (
                    <span style={{ fontSize: 24, fontWeight: 700, color: usingFallback ? '#fbbf24' : 'var(--accent-cyan)' }}>
                      {premiumFormatted} USDC
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-secondary)' }}>Enter coverage amount</span>
                  )}
                </div>
                {coverage && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {premiumPercent}% of coverage
                  </div>
                )}
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: usingFallback ? '#fbbf24' : 'var(--text-muted)' }}>
                {usingFallback
                  ? 'Using default rate - hazard curves initializing'
                  : 'Premium calculated from regime-based hazard curve'
                }
              </div>
            </div>

            {/* Summary */}
            {coverage && effectivePremium > 0n && (
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
                  <span style={{ color: 'var(--accent-cyan)' }}>{coverage} USDC</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Protection period</span>
                  <span style={{ color: 'var(--text-primary)' }}>{duration.label}</span>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            {needsApproval && !approveSuccess ? (
              <button
                onClick={handleApprove}
                disabled={!effectivePremium || !coverage || approving || waitingApprove}
                style={{
                  width: '100%',
                  padding: '14px',
                  background: approving || waitingApprove
                    ? 'rgba(168, 85, 247, 0.3)'
                    : 'linear-gradient(135deg, rgba(168, 85, 247, 0.8) 0%, rgba(0, 212, 255, 0.8) 100%)',
                  border: 'none',
                  borderRadius: 12,
                  color: '#fff',
                  fontSize: 16,
                  fontWeight: 600,
                  cursor: approving || waitingApprove ? 'wait' : 'pointer',
                  opacity: (!effectivePremium || !coverage) ? 0.5 : 1,
                }}
              >
                {approving || waitingApprove ? 'Approving USDC...' : 'Approve USDC'}
              </button>
            ) : (
              <button
                onClick={handleCreate}
                disabled={!effectivePremium || !coverage || issuingPolicy || waitingPolicy}
                style={{
                  width: '100%',
                  padding: '14px',
                  background: issuingPolicy || waitingPolicy
                    ? 'rgba(0, 212, 255, 0.3)'
                    : 'linear-gradient(135deg, #00d4ff 0%, #a855f7 100%)',
                  border: 'none',
                  borderRadius: 12,
                  color: '#fff',
                  fontSize: 16,
                  fontWeight: 600,
                  cursor: issuingPolicy || waitingPolicy ? 'wait' : 'pointer',
                  opacity: (!effectivePremium || !coverage) ? 0.5 : 1,
                }}
              >
                {issuingPolicy || waitingPolicy ? 'Creating Policy...' : 'Create Policy'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
