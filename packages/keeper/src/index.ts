import 'dotenv/config'
import { createPublicClient, createWalletClient, http } from 'viem'
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

// minimal ABI for the deployed PolicyManager
const pmAbi = [
  { type: 'function', name: 'asset', stateMutability: 'view', inputs: [], outputs: [{ type: 'address', name: '' }] },
  { type: 'function', name: 'pool', stateMutability: 'view', inputs: [], outputs: [{ type: 'address', name: '' }] },
  { type: 'function', name: 'curve', stateMutability: 'view', inputs: [], outputs: [{ type: 'address', name: '' }] },
  { type: 'function', name: 'oracle', stateMutability: 'view', inputs: [], outputs: [{ type: 'address', name: '' }] },
]

async function tick() {
  await pRetry(
    async () => {
      const [asset, pool, curve, oracle] = await Promise.all([
        publicClient.readContract({
          address: POLICY_MANAGER!,
          abi: pmAbi,
          functionName: 'asset',
          args: [],
        }),
        publicClient.readContract({
          address: POLICY_MANAGER!,
          abi: pmAbi,
          functionName: 'pool',
          args: [],
        }),
        publicClient.readContract({
          address: POLICY_MANAGER!,
          abi: pmAbi,
          functionName: 'curve',
          args: [],
        }),
        publicClient.readContract({
          address: POLICY_MANAGER!,
          abi: pmAbi,
          functionName: 'oracle',
          args: [],
        }),
      ])

      console.log('keeper heartbeat ✅', {
        pm: POLICY_MANAGER,
        asset,
        pool,
        curve,
        oracle,
      })
    },
    { retries: 3 }
  )
}

async function main() {
  console.log('Keeper online as', account.address)
  await tick()
  setInterval(tick, INTERVAL)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
