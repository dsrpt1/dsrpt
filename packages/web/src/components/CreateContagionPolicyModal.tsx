'use client'
import { useState } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi'
import { parseUnits, formatUnits } from 'viem'
import { CONTAGION, CONTAGION_ASSETS } from '@/lib/addresses'
import { CONTAGION_PRICING_ABI, ERC20_ABI } from '@/lib/abis'

type Props = {
  isOpen: boolean
  onClose: () => void
}

const TRANCHE_OPTIONS = [
  { label: 'Senior', value: 0, desc: '0-5% dilution', risk: 'Low' },
  { label: 'Mezzanine', value: 1, desc: '5-20% dilution', risk: 'Medium' },
  { label: 'Catastrophic', value: 2, desc: '20%+ dilution', risk: 'High' },
]

const DURATION_OPTIONS = [
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '180 days', value: 180 },
  { label: '365 days', value: 365 },
]

const POLICY_TYPES = [
  { label: 'Position Cover', value: 0, desc: 'Payout = notional × LTV × dilution' },
  { label: 'Protocol Cover', value: 1, desc: 'Payout = borrows × dilution (DAO treasury)' },
]

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const POLICY_MANAGER = CONTAGION.base.policyManager as `0x${string}`
const PRICING = CONTAGION.base.pricingEngine as `0x${string}`

const CONTAGION_PM_ABI = [
  {
    type: 'function',
    name: 'createPositionCover',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assetId', type: 'bytes32' },
      { name: 'notional', type: 'uint256' },
      { name: 'ltvBps', type: 'uint16' },
      { name: 'tranche', type: 'uint8' },
      { name: 'durationDays', type: 'uint32' },
      { name: 'premium', type: 'uint256' },
    ],
    outputs: [{ name: 'policyId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'createProtocolCover',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assetId', type: 'bytes32' },
      { name: 'notional', type: 'uint256' },
      { name: 'tranche', type: 'uint8' },
      { name: 'durationDays', type: 'uint32' },
      { name: 'premium', type: 'uint256' },
    ],
    outputs: [{ name: 'policyId', type: 'uint256' }],
  },
] as const

export default function CreateContagionPolicyModal({ isOpen, onClose }: Props) {
  const [selectedAsset, setSelectedAsset] = useState(CONTAGION_ASSETS[0])
  const [policyType, setPolicyType] = useState(POLICY_TYPES[0])
  const [tranche, setTranche] = useState(TRANCHE_OPTIONS[1]) // default mezzanine
  const [notional, setNotional] = useState('')
  const [ltvBps, setLtvBps] = useState('9300')
  const [duration, setDuration] = useState(DURATION_OPTIONS[1]) // default 90d
  const [step, setStep] = useState<'input' | 'approve' | 'create'>('input')
  const { address } = useAccount()

  const notionalBn = notional ? parseUnits(notional, 6) : 0n

  // Quote premium
  const { data: quotedPremium, isLoading: premiumLoading } = useReadContract({
    address: PRICING,
    abi: CONTAGION_PRICING_ABI,
    functionName: 'quotePremiumSimple',
    args: [selectedAsset.perilId as `0x${string}`, notionalBn, BigInt(duration.value)],
    query: { enabled: notionalBn > 0n },
  })

  const premium = quotedPremium ?? 0n
  const premiumFormatted = premium > 0n ? formatUnits(premium, 6) : '0'
  const premiumPct = notionalBn > 0n ? ((Number(premium) / Number(notionalBn)) * 100).toFixed(3) : '0'

  // Check USDC allowance
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, POLICY_MANAGER] : undefined,
    query: { enabled: !!address },
  })

  const needsApproval = allowance !== undefined && premium > 0n && premium > allowance

  // Approve
  const { writeContract: approve, data: approveTx, isPending: approving } = useWriteContract()
  const { isLoading: waitingApprove, isSuccess: approveSuccess } = useWaitForTransactionReceipt({ hash: approveTx })

  // Create policy
  const { writeContract: createPolicy, data: policyTx, isPending: creating } = useWriteContract()
  const { isLoading: waitingPolicy, isSuccess: policySuccess } = useWaitForTransactionReceipt({ hash: policyTx })

  if (approveSuccess && step === 'approve') {
    refetchAllowance()
    setStep('create')
  }

  const handleApprove = () => {
    if (!premium) return
    setStep('approve')
    approve({
      address: USDC as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [POLICY_MANAGER, premium],
    })
  }

  const handleCreate = () => {
    if (!premium || !notional || !address) return
    setStep('create')

    if (policyType.value === 0) {
      createPolicy({
        address: POLICY_MANAGER,
        abi: CONTAGION_PM_ABI,
        functionName: 'createPositionCover',
        args: [
          selectedAsset.perilId as `0x${string}`,
          notionalBn,
          parseInt(ltvBps) as unknown as number,
          tranche.value,
          duration.value,
          premium,
        ],
      })
    } else {
      createPolicy({
        address: POLICY_MANAGER,
        abi: CONTAGION_PM_ABI,
        functionName: 'createProtocolCover',
        args: [
          selectedAsset.perilId as `0x${string}`,
          notionalBn,
          tranche.value,
          duration.value,
          premium,
        ],
      })
    }
  }

  const handleClose = () => {
    setNotional('')
    setStep('input')
    onClose()
  }

  if (!isOpen) return null

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={handleClose}
    >
      <div className="card" style={{ width: '100%', maxWidth: 480, padding: 24, margin: 16, maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Contagion Cover</h2>
          <button onClick={handleClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: 24, cursor: 'pointer' }}>&times;</button>
        </div>

        {policySuccess ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🛡️</div>
            <div style={{ color: '#4ade80', fontSize: 18, marginBottom: 8 }}>Policy Created!</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
              Contagion cover is now active for {selectedAsset.symbol}
            </div>
            <div style={{ marginTop: 16, padding: 16, background: 'rgba(0,0,0,0.2)', borderRadius: 12, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span style={{ color: 'var(--text-muted)' }}>Asset</span><span style={{ color: 'var(--text-primary)' }}>{selectedAsset.symbol}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span style={{ color: 'var(--text-muted)' }}>Notional</span><span style={{ color: 'var(--text-primary)' }}>${notional}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span style={{ color: 'var(--text-muted)' }}>Premium</span><span style={{ color: 'var(--text-primary)' }}>{premiumFormatted} USDC</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span style={{ color: 'var(--text-muted)' }}>Tranche</span><span style={{ color: 'var(--text-primary)' }}>{tranche.label}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}>Duration</span><span style={{ color: 'var(--text-primary)' }}>{duration.label}</span></div>
            </div>
            <button onClick={handleClose} style={{ marginTop: 24, padding: '12px 32px', background: 'linear-gradient(135deg, #00d4ff 0%, #a855f7 100%)', border: 'none', borderRadius: 12, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Done</button>
          </div>
        ) : (
          <>
            {/* Wrapped Asset */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 8, color: 'var(--text-secondary)', fontSize: 13 }}>Wrapped Asset</label>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(CONTAGION_ASSETS.length, 5)}, 1fr)`, gap: 6 }}>
                {CONTAGION_ASSETS.map(a => (
                  <button key={a.symbol} onClick={() => setSelectedAsset(a)} style={{
                    padding: '10px 4px', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
                    background: selectedAsset.symbol === a.symbol ? 'rgba(0,212,255,0.2)' : 'rgba(0,0,0,0.2)',
                    border: selectedAsset.symbol === a.symbol ? '1px solid rgba(0,212,255,0.5)' : '1px solid rgba(255,255,255,0.1)',
                    color: selectedAsset.symbol === a.symbol ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                  }}>
                    {a.symbol}
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>{a.source}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Policy Type */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 8, color: 'var(--text-secondary)', fontSize: 13 }}>Policy Type</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {POLICY_TYPES.map(pt => (
                  <button key={pt.value} onClick={() => setPolicyType(pt)} style={{
                    padding: '12px 8px', fontSize: 13, borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                    background: policyType.value === pt.value ? 'rgba(168,85,247,0.15)' : 'rgba(0,0,0,0.2)',
                    border: policyType.value === pt.value ? '1px solid rgba(168,85,247,0.4)' : '1px solid rgba(255,255,255,0.1)',
                    color: policyType.value === pt.value ? '#a855f7' : 'var(--text-secondary)',
                  }}>
                    <div style={{ fontWeight: 600 }}>{pt.label}</div>
                    <div style={{ fontSize: 10, marginTop: 4, color: 'var(--text-muted)' }}>{pt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Tranche */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 8, color: 'var(--text-secondary)', fontSize: 13 }}>Tranche</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {TRANCHE_OPTIONS.map(t => (
                  <button key={t.value} onClick={() => setTranche(t)} style={{
                    padding: '10px 6px', fontSize: 12, borderRadius: 8, cursor: 'pointer',
                    background: tranche.value === t.value ? 'rgba(0,212,255,0.15)' : 'rgba(0,0,0,0.2)',
                    border: tranche.value === t.value ? '1px solid rgba(0,212,255,0.4)' : '1px solid rgba(255,255,255,0.1)',
                    color: tranche.value === t.value ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                  }}>
                    <div style={{ fontWeight: 600 }}>{t.label}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{t.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Notional */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 8, color: 'var(--text-secondary)', fontSize: 13 }}>
                {policyType.value === 0 ? 'Position Size (USDC)' : 'Borrow Exposure (USDC)'}
              </label>
              <input type="number" value={notional} onChange={e => setNotional(e.target.value)} placeholder="1000000"
                style={{ width: '100%', padding: '14px 16px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,212,255,0.2)', borderRadius: 12, color: 'var(--text-primary)', fontSize: 16, outline: 'none' }} />
            </div>

            {/* LTV (position cover only) */}
            {policyType.value === 0 && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 8, color: 'var(--text-secondary)', fontSize: 13 }}>
                  LTV at Listing (bps) — e.g. 9300 = 93%
                </label>
                <input type="number" value={ltvBps} onChange={e => setLtvBps(e.target.value)} placeholder="9300"
                  style={{ width: '100%', padding: '14px 16px', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(0,212,255,0.2)', borderRadius: 12, color: 'var(--text-primary)', fontSize: 16, outline: 'none' }} />
                <div style={{ marginTop: 6, color: 'var(--text-muted)', fontSize: 12 }}>
                  Payout = {notional || '0'} × {(parseInt(ltvBps || '0') / 100).toFixed(1)}% × dilution at breach
                </div>
              </div>
            )}

            {/* Duration */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', marginBottom: 8, color: 'var(--text-secondary)', fontSize: 13 }}>Duration</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {DURATION_OPTIONS.map(d => (
                  <button key={d.value} onClick={() => setDuration(d)} style={{
                    padding: '10px 6px', fontSize: 12, borderRadius: 8, cursor: 'pointer',
                    background: duration.value === d.value ? 'rgba(0,212,255,0.2)' : 'rgba(0,0,0,0.2)',
                    border: duration.value === d.value ? '1px solid rgba(0,212,255,0.5)' : '1px solid rgba(255,255,255,0.1)',
                    color: duration.value === d.value ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                  }}>{d.label}</button>
                ))}
              </div>
            </div>

            {/* Premium Quote */}
            <div style={{
              marginBottom: 20, padding: 16, borderRadius: 12,
              background: 'linear-gradient(135deg, rgba(168,85,247,0.08), rgba(0,212,255,0.08))',
              border: '1px solid rgba(168,85,247,0.2)',
            }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Contagion Cover Premium</div>
              {premiumLoading ? (
                <span style={{ color: 'var(--text-secondary)' }}>Calculating...</span>
              ) : notional ? (
                <>
                  <span style={{ fontSize: 24, fontWeight: 700, color: '#a855f7' }}>{premiumFormatted} USDC</span>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{premiumPct}% of notional</div>
                </>
              ) : (
                <span style={{ color: 'var(--text-secondary)' }}>Enter coverage amount</span>
              )}
            </div>

            {/* Summary */}
            {notional && premium > 0n && (
              <div style={{ marginBottom: 20, padding: 16, background: 'rgba(0,0,0,0.2)', borderRadius: 12, fontSize: 13 }}>
                <div style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>Summary</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span style={{ color: 'var(--text-muted)' }}>Asset</span><span style={{ color: 'var(--text-primary)' }}>{selectedAsset.symbol} ({selectedAsset.source})</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span style={{ color: 'var(--text-muted)' }}>Type</span><span style={{ color: 'var(--text-primary)' }}>{policyType.label}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span style={{ color: 'var(--text-muted)' }}>Tranche</span><span style={{ color: 'var(--text-primary)' }}>{tranche.label} ({tranche.desc})</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span style={{ color: 'var(--text-muted)' }}>You pay</span><span style={{ color: '#a855f7' }}>{premiumFormatted} USDC</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}><span style={{ color: 'var(--text-muted)' }}>Covered notional</span><span style={{ color: 'var(--accent-cyan)' }}>${notional}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}>Duration</span><span style={{ color: 'var(--text-primary)' }}>{duration.label}</span></div>
              </div>
            )}

            {/* Action */}
            {needsApproval && !approveSuccess ? (
              <button onClick={handleApprove} disabled={!premium || !notional || approving || waitingApprove} style={{
                width: '100%', padding: '14px', border: 'none', borderRadius: 12, color: '#fff', fontSize: 16, fontWeight: 600,
                background: approving || waitingApprove ? 'rgba(168,85,247,0.3)' : 'linear-gradient(135deg, rgba(168,85,247,0.8), rgba(0,212,255,0.8))',
                cursor: approving || waitingApprove ? 'wait' : 'pointer', opacity: (!premium || !notional) ? 0.5 : 1,
              }}>
                {approving || waitingApprove ? 'Approving USDC...' : 'Approve USDC'}
              </button>
            ) : (
              <button onClick={handleCreate} disabled={!premium || !notional || creating || waitingPolicy} style={{
                width: '100%', padding: '14px', border: 'none', borderRadius: 12, color: '#fff', fontSize: 16, fontWeight: 600,
                background: creating || waitingPolicy ? 'rgba(0,212,255,0.3)' : 'linear-gradient(135deg, #00d4ff 0%, #a855f7 100%)',
                cursor: creating || waitingPolicy ? 'wait' : 'pointer', opacity: (!premium || !notional) ? 0.5 : 1,
              }}>
                {creating || waitingPolicy ? 'Creating Policy...' : 'Create Contagion Cover'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
