'use client'
import { useState } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi'
import { parseUnits, formatUnits } from 'viem'
import { ADDRESSES } from '@/lib/addresses'
import { ERC20_ABI, LIQUIDITY_POOL_ABI } from '@/lib/abis'

type Props = {
  isOpen: boolean
  onClose: () => void
}

export default function FundPoolModal({ isOpen, onClose }: Props) {
  const [amount, setAmount] = useState('')
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

  // Read current allowance
  const { data: allowance } = useReadContract({
    address: A.usdc as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, A.pool as `0x${string}`] : undefined,
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

  const amountBn = amount ? parseUnits(amount, 6) : BigInt(0)
  const needsApproval = allowance !== undefined && amountBn > allowance

  const handleApprove = () => {
    setStep('approve')
    approve({
      address: A.usdc as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [A.pool as `0x${string}`, amountBn],
    })
  }

  const handleDeposit = () => {
    setStep('deposit')
    deposit({
      address: A.pool as `0x${string}`,
      abi: LIQUIDITY_POOL_ABI,
      functionName: 'deposit',
      args: [amountBn],
    })
  }

  const handleClose = () => {
    setAmount('')
    setStep('input')
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
              {amount} USDC deposited to the pool
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
              <div style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: 12 }}>
                Balance: {balance ? formatUnits(balance, 6) : '0'} USDC
              </div>
            </div>

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
                {depositing || waitingDeposit ? 'Depositing...' : 'Deposit USDC'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
