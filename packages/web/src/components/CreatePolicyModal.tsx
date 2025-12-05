'use client'
import { useState } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseUnits } from 'viem'
import { ADDRESSES } from '@/lib/addresses'
import { POLICY_MANAGER_ABI } from '@/lib/abis'

type Props = {
  isOpen: boolean
  onClose: () => void
}

const DURATION_OPTIONS = [
  { label: '7 days', value: 7 * 24 * 60 * 60 },
  { label: '14 days', value: 14 * 24 * 60 * 60 },
  { label: '30 days', value: 30 * 24 * 60 * 60 },
]

export default function CreatePolicyModal({ isOpen, onClose }: Props) {
  const [payout, setPayout] = useState('')
  const [premium, setPremium] = useState('')
  const [duration, setDuration] = useState(DURATION_OPTIONS[0].value)
  const { address } = useAccount()
  const A = ADDRESSES.base

  // Create policy transaction
  const { writeContract, data: txHash, isPending } = useWriteContract()
  const { isLoading: waiting, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  const handleCreate = () => {
    if (!premium || !payout) return
    writeContract({
      address: A.pm as `0x${string}`,
      abi: POLICY_MANAGER_ABI,
      functionName: 'createPolicy',
      args: [
        parseUnits(premium, 6),  // premium in USDC (6 decimals)
        parseUnits(payout, 6),   // payout in USDC (6 decimals)
        BigInt(duration),
      ],
    })
  }

  const handleClose = () => {
    setPayout('')
    setPremium('')
    setDuration(DURATION_OPTIONS[0].value)
    onClose()
  }

  // Auto-calculate suggested premium (naive: 5% of payout)
  const suggestedPremium = payout ? (parseFloat(payout) * 0.05).toFixed(2) : ''

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
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Duration</span>
                <span style={{ color: 'var(--text-primary)', fontSize: 13 }}>
                  {DURATION_OPTIONS.find(d => d.value === duration)?.label}
                </span>
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
                onChange={(e) => {
                  setPayout(e.target.value)
                  // Auto-set suggested premium
                  if (e.target.value) {
                    setPremium((parseFloat(e.target.value) * 0.05).toFixed(2))
                  }
                }}
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

            {/* Premium */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 8, color: 'var(--text-secondary)', fontSize: 13 }}>
                Premium (USDC)
              </label>
              <input
                type="number"
                value={premium}
                onChange={(e) => setPremium(e.target.value)}
                placeholder={suggestedPremium || '50'}
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid rgba(168, 85, 247, 0.2)',
                  borderRadius: 12,
                  color: 'var(--text-primary)',
                  fontSize: 16,
                  outline: 'none',
                }}
              />
              <div style={{ marginTop: 6, color: 'var(--text-muted)', fontSize: 12 }}>
                One-time payment for protection (~5% suggested)
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
                    onClick={() => setDuration(opt.value)}
                    style={{
                      flex: 1,
                      padding: '12px',
                      background: duration === opt.value
                        ? 'rgba(0, 212, 255, 0.2)'
                        : 'rgba(0, 0, 0, 0.2)',
                      border: duration === opt.value
                        ? '1px solid rgba(0, 212, 255, 0.5)'
                        : '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: 8,
                      color: duration === opt.value ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                      fontSize: 14,
                      cursor: 'pointer',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Summary */}
            {payout && premium && (
              <div style={{
                marginBottom: 20,
                padding: 16,
                background: 'rgba(0, 212, 255, 0.05)',
                border: '1px solid rgba(0, 212, 255, 0.1)',
                borderRadius: 12,
              }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>Summary</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: 'var(--text-muted)' }}>You pay</span>
                  <span style={{ color: 'var(--accent-purple)' }}>{premium} USDC</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>You receive if depeg</span>
                  <span style={{ color: 'var(--accent-cyan)' }}>{payout} USDC</span>
                </div>
              </div>
            )}

            <button
              onClick={handleCreate}
              disabled={!premium || !payout || isPending || waiting}
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
                opacity: (!premium || !payout) ? 0.5 : 1,
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
