import 'dotenv/config'
import { createPublicClient, createWalletClient, http, parseAbiItem } from 'viem'
import { base } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import pRetry from 'p-retry'

const RPC_URL = process.env.RPC_URL || 'https://mainnet.base.org'
const POLICY_MANAGER = process.env.POLICY_MANAGER as `0x${string}` | undefined
const ADAPTER = process.env.ADAPTER as `0x${string}` | undefined
const KPK = process.env.KEEPER_PRIVATE_KEY as `0x${string}` | undefined
const INTERVAL = Number(process.env.CHECK_INTERVAL_MS || 60000)

if (!POLICY_MANAGER || !ADAPTER || !KPK) {
  console.error('keeper: missing env (POLICY_MANAGER / ADAPTER / KEEPER_PRIVATE_KEY)')
  process.exit(1)
}

const account = privateKeyToAccount(KPK)

const publicClient = createPublicClient({
  chain: base,
  transport: http(RPC_URL),
})

const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(RPC_URL),
})

// Complete ABIs for keeper operations
const pmAbi = [
  { type: 'function', name: 'nextPolicyId', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
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
  },
  {
    type: 'function',
    name: 'resolve',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: []
  },
] as const

const oracleAbi = [
  {
    type: 'function',
    name: 'latestPrice',
    stateMutability: 'view',
    inputs: [{ name: 'assetId', type: 'bytes32' }],
    outputs: [
      { name: 'price', type: 'int256' },
      { name: 'updatedAt', type: 'uint256' }
    ]
  },
  {
    type: 'function',
    name: 'threshold1e8',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'setCondition',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'policyId', type: 'bytes32' },
      { name: 'met', type: 'bool' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'conditionMet',
    stateMutability: 'view',
    inputs: [{ name: 'policyId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    type: 'function',
    name: 'resolved',
    stateMutability: 'view',
    inputs: [{ name: 'policyId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }]
  }
] as const

interface Policy {
  buyer: `0x${string}`
  payout: bigint
  premium: bigint
  startTs: bigint
  endTs: bigint
  resolved: boolean
}

// USDC asset ID (bytes32(0) for default)
const USDC_ASSET_ID = '0x0000000000000000000000000000000000000000000000000000000000000000'

async function checkAndResolvePolicy(policyId: number) {
  try {
    console.log(`\n--- Checking Policy #${policyId} ---`)

    // 1. Read policy details
    const policy = await publicClient.readContract({
      address: POLICY_MANAGER!,
      abi: pmAbi,
      functionName: 'policies',
      args: [BigInt(policyId)],
    }) as unknown as Policy

    const now = BigInt(Math.floor(Date.now() / 1000))

    // Skip if already resolved
    if (policy.resolved) {
      console.log(`Policy #${policyId}: Already resolved ✓`)
      return
    }

    // Skip if not yet expired
    if (policy.endTs > now) {
      const remainingSeconds = Number(policy.endTs - now)
      const remainingHours = (remainingSeconds / 3600).toFixed(1)
      console.log(`Policy #${policyId}: Still active (expires in ${remainingHours}h)`)
      return
    }

    console.log(`Policy #${policyId}: EXPIRED - Ready to resolve!`)
    console.log(`  Buyer: ${policy.buyer}`)
    console.log(`  Payout: ${policy.payout.toString()}`)
    console.log(`  Premium: ${policy.premium.toString()}`)
    console.log(`  Expired at: ${new Date(Number(policy.endTs) * 1000).toISOString()}`)

    // 2. Check if oracle condition has been set
    const policyIdBytes32 = `0x${policyId.toString(16).padStart(64, '0')}` as `0x${string}`

    const oracleResolved = await publicClient.readContract({
      address: ADAPTER!,
      abi: oracleAbi,
      functionName: 'resolved',
      args: [policyIdBytes32],
    })

    // 3. If oracle condition not set, check price and set condition
    if (!oracleResolved) {
      console.log(`  Oracle condition not set yet. Checking price...`)

      // Fetch current USDC price
      const [price, updatedAt] = await publicClient.readContract({
        address: ADAPTER!,
        abi: oracleAbi,
        functionName: 'latestPrice',
        args: [USDC_ASSET_ID as `0x${string}`],
      }) as [bigint, bigint]

      const threshold = await publicClient.readContract({
        address: ADAPTER!,
        abi: oracleAbi,
        functionName: 'threshold1e8',
      }) as bigint

      const priceFormatted = Number(price) / 1e8
      const thresholdFormatted = Number(threshold) / 1e8

      console.log(`  Current USDC Price: $${priceFormatted.toFixed(6)} (threshold: $${thresholdFormatted.toFixed(6)})`)
      console.log(`  Price updated at: ${new Date(Number(updatedAt) * 1000).toISOString()}`)

      // Determine if condition was met (price went below threshold during policy period)
      // In production, you'd want to check historical prices during the policy period
      // For now, we'll check if price is currently below threshold
      const conditionMet = price < threshold

      console.log(`  Condition Met: ${conditionMet}`)

      // Set the condition on oracle
      console.log(`  Setting oracle condition...`)
      const setConditionHash = await walletClient.writeContract({
        address: ADAPTER!,
        abi: oracleAbi,
        functionName: 'setCondition',
        args: [policyIdBytes32, conditionMet],
      })

      console.log(`  ✓ setCondition() tx: ${setConditionHash}`)

      // Wait for confirmation
      await publicClient.waitForTransactionReceipt({
        hash: setConditionHash,
        confirmations: 1,
      })
      console.log(`  ✓ setCondition() confirmed`)
    } else {
      const conditionMet = await publicClient.readContract({
        address: ADAPTER!,
        abi: oracleAbi,
        functionName: 'conditionMet',
        args: [policyIdBytes32],
      })
      console.log(`  Oracle condition already set: ${conditionMet}`)
    }

    // 4. Call PolicyManager.resolve()
    console.log(`  Resolving policy on PolicyManager...`)

    const resolveHash = await walletClient.writeContract({
      address: POLICY_MANAGER!,
      abi: pmAbi,
      functionName: 'resolve',
      args: [BigInt(policyId)],
    })

    console.log(`  ✓ resolve() tx: ${resolveHash}`)

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: resolveHash,
      confirmations: 1,
    })

    console.log(`  ✓ resolve() confirmed in block ${receipt.blockNumber}`)

    // Parse PolicyResolved event
    const policyResolvedEvent = receipt.logs.find(log => {
      try {
        const decoded = publicClient.parseEventLogs({
          abi: [{
            type: 'event',
            name: 'PolicyResolved',
            inputs: [
              { indexed: true, name: 'id', type: 'uint256' },
              { indexed: false, name: 'paid', type: 'bool' },
              { indexed: false, name: 'payoutAmount', type: 'uint256' }
            ]
          }],
          logs: [log]
        })
        return decoded.length > 0
      } catch {
        return false
      }
    })

    if (policyResolvedEvent) {
      console.log(`\n✅ Policy #${policyId} RESOLVED SUCCESSFULLY`)
    }

  } catch (error: any) {
    console.error(`❌ Error processing policy #${policyId}:`, error.message)
    if (error.cause) {
      console.error('  Cause:', error.cause.message || error.cause)
    }
  }
}

async function tick() {
  await pRetry(
    async () => {
      console.log('\n========================================')
      console.log(`Keeper heartbeat at ${new Date().toISOString()}`)
      console.log('========================================')

      // Get total number of policies
      const nextPolicyId = await publicClient.readContract({
        address: POLICY_MANAGER!,
        abi: pmAbi,
        functionName: 'nextPolicyId',
      }) as bigint

      const totalPolicies = Number(nextPolicyId) - 1

      if (totalPolicies === 0) {
        console.log('No policies created yet.')
        return
      }

      console.log(`Total policies: ${totalPolicies}`)

      // Check each policy
      for (let i = 1; i <= totalPolicies; i++) {
        await checkAndResolvePolicy(i)
      }

      console.log('\n========================================')
      console.log(`Heartbeat complete. Next check in ${INTERVAL / 1000}s`)
      console.log('========================================\n')
    },
    { retries: 3, onFailedAttempt: (error) => {
      console.log(`Attempt ${error.attemptNumber} failed. Retrying...`)
    }}
  )
}

async function main() {
  console.log('\n')
  console.log('╔═══════════════════════════════════════╗')
  console.log('║   DSRPT Keeper Bot - ONLINE          ║')
  console.log('╚═══════════════════════════════════════╝')
  console.log(`Keeper address: ${account.address}`)
  console.log(`PolicyManager: ${POLICY_MANAGER}`)
  console.log(`Oracle Adapter: ${ADAPTER}`)
  console.log(`Check interval: ${INTERVAL / 1000}s`)
  console.log(`Network: Base Mainnet`)
  console.log('\n')

  // Run first check immediately
  await tick()

  // Then run periodically
  setInterval(tick, INTERVAL)
}

main().catch((e) => {
  console.error('Fatal error:', e)
  process.exit(1)
})
