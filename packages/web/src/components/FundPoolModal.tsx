'use client'
import { useState } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi'
import { parseUnits, formatUnits } from 'viem'
import { ADDRESSES, TRANCHE_IDS } from '@/lib/addresses'
import { ERC20_ABI, TREASURY_MANAGER_ABI } from '@/lib/abis'

type Props = {
  isOpen: boolean
  onClose: () => void
}

const TRANCHE_OPTIONS = [
  {
    id: TRANCHE_IDS.JUNIOR,
    name: 'Junior',
    description: 'First loss, highest yield',
    targetYield: '15%',
    risk: 'High',
    color: '#ef4444',
  },
  {
    id: TRANCHE_IDS.MEZZANINE,
    name: 'Mezzanine',
    description: 'Second loss, moderate yield',
    targetYield: '8%',
    risk: 'Medium',
    color: '#fbbf24',
  },
  {
    id: TRANCHE_IDS.SENIOR,
    name: 'Senior',
    description: 'Last loss, safest',
    targetYield: '4%',
    risk: 'Low',
    color: '#22c55e',
  },
]

export default function FundPoolModal({ isOpen, onClose }: Props) {
  const [amount, setAmount] = useState('')
  const [selectedTranche, setSelectedTranche] = useState(TRANCHE_OPTIONS[0])
  const [step, setStep] = useState<'input' | 'approve' | 'deposit'>('input')
  const { address } = useAccount()
  const A = ADDRESSES.base

  // Read user's USDC balance
  const { data: balance } = useReadContract({
    address: A.usdc as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })

  // Read current allowance for TreasuryManager
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: A.usdc as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, A.treasuryManager as `0x${string}`] : undefined,
    query: { enabled: !!address },
  })

  // Read tranche assets for display
  const { data: juniorAssets } = useReadContract({
    address: A.treasuryManager as `0x${string}`,
    abi: TREASURY_MANAGER_ABI,
    functionName: 'getTrancheAssets',
    args: [TRANCHE_IDS.JUNIOR],
  })

  const { data: mezzAssets } = useReadContract({
    address: A.treasuryManager as `0x${string}`,
    abi: TREASURY_MANAGER_ABI,
    functionName: 'getTrancheAssets',
    args: [TRANCHE_IDS.MEZZANINE],
  })

  const { data: seniorAssets } = useReadContract({
    address: A.treasuryManager as `0x${string}`,
    abi: TREASURY_MANAGER_ABI,
    functionName: 'getTrancheAssets',
    args: [TRANCHE_IDS.SENIOR],
  })

  // Read user's shares in selected tranche
  const { data: userShares } = useReadContract({
    address: A.treasuryManager as `0x${string}`,
    abi: TREASURY_MANAGER_ABI,
    functionName: 'getDepositorShares',
    args: address ? [address, selectedTranche.id] : undefined,
    query: { enabled: !!address },
  })

  // Approve transaction
  const { writeContract: approve, data: approveTx, isPending: approving } = useWriteContract()
  const { isLoading: waitingApprove, isSuccess: approveSuccess } = useWaitForTransactionReceipt({
    hash: approveTx,
  })

  // Deposit transaction
  const { writeContract: deposit, data: depositTx, isPending: depositing } = useWriteContract()
  const { isLoading: waitingDeposit, isSuccess: depositSuccess } = useWaitForTransactionReceipt({
    hash: depositTx,
  })

  const amountBn = amount ? parseUnits(amount, 6) : 0n
  const needsApproval = allowance !== undefined && amountBn > allowance

  // Refetch allowance after approval
  if (approveSuccess && step === 'approve') {
    refetchAllowance()
    setStep('deposit')
  }

  const handleApprove = () => {
    setStep('approve')
    approve({
      address: A.usdc as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [A.treasuryManager as `0x${string}`, amountBn],
    })
  }

  const handleDeposit = () => {
    setStep('deposit')
    deposit({
      address: A.treasuryManager as `0x${string}`,
      abi: TREASURY_MANAGER_ABI,
      functionName: 'deposit',
      args: [selectedTranche.id, amountBn],
    })
  }

  const handleClose = () => {
    setAmount('')
    setSelectedTranche(TRANCHE_OPTIONS[0])
    setStep('input')
    onClose()
  }

  // Calculate total TVL
  const totalTVL = (juniorAssets || 0n) + (mezzAssets || 0n) + (seniorAssets || 0n)

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
          maxWidth: 480,
          padding: 24,
          margin: 16,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Fund Liquidity Pool</h2>
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

        {depositSuccess ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
            <div style={{ color: '#4ade80', fontSize: 18, marginBottom: 8 }}>Deposit Successful!</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
              {amount} USDC deposited to {selectedTranche.name} tranche
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
            {/* Pool Stats */}
            <div style={{
              marginBottom: 20,
              padding: 16,
              background: 'rgba(0, 0, 0, 0.2)',
              borderRadius: 12,
            }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>Pool Overview</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ color: 'var(--text-secondary)' }}>Total TVL</span>
                <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>
                  {formatUnits(totalTVL, 6)} USDC
                </span>
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {TRANCHE_OPTIONS.map((t) => {
                  const assets = t.id === 0 ? juniorAssets : t.id === 1 ? mezzAssets : seniorAssets
                  return (
                    <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: t.color }}>{t.name}</span>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {formatUnits(assets || 0n, 6)} USDC
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Tranche Selection */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', marginBottom: 8, color: 'var(--text-secondary)', fontSize: 13 }}>
                Select Tranche
              </label>
              <div style={{ display: 'grid', gap: 8 }}>
                {TRANCHE_OPTIONS.map((tranche) => (
                  <button
                    key={tranche.id}
                    onClick={() => setSelectedTranche(tranche)}
                    style={{
                      padding: '12px 16px',
                      background: selectedTranche.id === tranche.id
                        ? `rgba(${tranche.color === '#ef4444' ? '239, 68, 68' : tranche.color === '#fbbf24' ? '251, 191, 36' : '34, 197, 94'}, 0.15)`
                        : 'rgba(0, 0, 0, 0.2)',
                      border: selectedTranche.id === tranche.id
                        ? `1px solid ${tranche.color}`
                        : '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: 12,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ color: tranche.color, fontWeight: 600, fontSize: 14 }}>{tranche.name}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{tranche.description}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ color: 'var(--text-primary)', fontSize: 14 }}>{tranche.targetYield} APY</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{tranche.risk} Risk</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Amount Input */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', marginBottom: 8, color: 'var(--text-secondary)', fontSize: 13 }}>
                Amount (USDC)
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  style={{
                    width: '100%',
                    padding: '14px 16px',
                    paddingRight: 80,
                    background: 'rgba(0, 0, 0, 0.3)',
                    border: '1px solid rgba(0, 212, 255, 0.2)',
                    borderRadius: 12,
                    color: 'var(--text-primary)',
                    fontSize: 18,
                    outline: 'none',
                  }}
                />
                <button
                  onClick={() => balance && setAmount(formatUnits(balance, 6))}
                  style={{
                    position: 'absolute',
                    right: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    padding: '6px 12px',
                    background: 'rgba(0, 212, 255, 0.1)',
                    border: '1px solid rgba(0, 212, 255, 0.3)',
                    borderRadius: 6,
                    color: 'var(--accent-cyan)',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  MAX
                </button>
              </div>
              <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: 'var(--text-muted)' }}>
                  Balance: {balance ? formatUnits(balance, 6) : '0'} USDC
                </span>
                {userShares && userShares > 0n && (
                  <span style={{ color: 'var(--text-muted)' }}>
                    Your shares: {formatUnits(userShares, 6)}
                  </span>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            {needsApproval && !approveSuccess ? (
              <button
                onClick={handleApprove}
                disabled={!amount || approving || waitingApprove}
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
                  opacity: !amount ? 0.5 : 1,
                }}
              >
                {approving || waitingApprove ? 'Approving...' : 'Approve USDC'}
              </button>
            ) : (
              <button
                onClick={handleDeposit}
                disabled={!amount || depositing || waitingDeposit}
                style={{
                  width: '100%',
                  padding: '14px',
                  background: depositing || waitingDeposit
                    ? 'rgba(0, 212, 255, 0.3)'
                    : 'linear-gradient(135deg, #00d4ff 0%, #a855f7 100%)',
                  border: 'none',
                  borderRadius: 12,
                  color: '#fff',
                  fontSize: 16,
                  fontWeight: 600,
                  cursor: depositing || waitingDeposit ? 'wait' : 'pointer',
                  opacity: !amount ? 0.5 : 1,
                }}
              >
                {depositing || waitingDeposit ? 'Depositing...' : `Deposit to ${selectedTranche.name}`}
              </button>
            )}

            {/* Tranche Info */}
            <div style={{
              marginTop: 16,
              padding: 12,
              background: 'rgba(0, 0, 0, 0.15)',
              borderRadius: 8,
              fontSize: 11,
              color: 'var(--text-muted)',
            }}>
              <strong>Note:</strong> Withdrawals have a 7-day cooldown period. Junior tranche bears first losses but earns highest yield.
            </div>
          </>
        )}
      </div>
    </div>
  )
}
