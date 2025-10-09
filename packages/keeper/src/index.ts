import 'dotenv/config';
import pRetry from 'p-retry';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  keccak256,
  toBytes
} from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const RPC_URL = process.env.RPC_URL || 'https://mainnet.base.org';
const POLICY_MANAGER = process.env.POLICY_MANAGER as `0x${string}` | undefined;
const ADAPTER = process.env.ADAPTER as `0x${string}` | undefined;
const KPK = process.env.KEEPER_PRIVATE_KEY;

if (!POLICY_MANAGER || !ADAPTER || !KPK) {
  console.error('Missing env: POLICY_MANAGER, ADAPTER, KEEPER_PRIVATE_KEY');
  process.exit(1);
}

const account = privateKeyToAccount((KPK.startsWith('0x') ? KPK : `0x${KPK}`) as `0x${string}`);
const publicClient = createPublicClient({ chain: base, transport: http(RPC_URL) });
const walletClient = createWalletClient({ chain: base, transport: http(RPC_URL), account });

// Minimal ABIs
const policyAbi = parseAbi([
  'function resolve(uint256 policyId) external',
  'function policies(uint256) view returns (address buyer, bytes32 productId, bytes32 assetId, uint256 coverage, uint64 startTs, uint32 tenorDays, bool active, bool paidOut)'
]);

const adapterAbi = parseAbi([
  'function setCondition(bytes32 policyId, bool met) external',
  'function conditionMet(bytes32 policyId) view returns (bool)'
]);

// Policy key must match PolicyManager._policyKey: keccak256(abi.encodePacked("POLICY", policyId))
function policyKey(id: bigint): `0x${string}` {
  const encoded = new Uint8Array([...toBytes('POLICY'), ...toBytes(`0x${id.toString(16)}`)]);
  return keccak256(encoded);
}

// For demo: provide policy IDs via env (comma-separated)
const POLICY_IDS: bigint[] = (process.env.POLICY_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
  .map(s => BigInt(s));

async function maybeResolve(id: bigint) {
  const pol = await publicClient.readContract({
    address: POLICY_MANAGER as `0x${string}`,
    abi: policyAbi,
    functionName: 'policies',
    args: [id]
  });

  const active = pol[6] as boolean;
  const paid = pol[7] as boolean;
  if (!active || paid) return;

  const key = policyKey(id);

  // MVP flow: set condition if your off-chain rule is met.
  if (!process.env.DRY_RUN) {
    await walletClient.writeContract({
      address: ADAPTER as `0x${string}`,
      abi: adapterAbi,
      functionName: 'setCondition',
      args: [key, true]
    });
  }

  await walletClient.writeContract({
    address: POLICY_MANAGER as `0x${string}`,
    abi: policyAbi,
    functionName: 'resolve',
    args: [id]
  });

  console.log(`Resolved policy ${id.toString()}`);
}

async function tick() {
  for (const id of POLICY_IDS) {
    await pRetry(() => maybeResolve(id), { retries: 2 });
  }
}

async function main() {
  console.log('Keeper online as', account.address);
  await tick();
  const interval = Number(process.env.CHECK_INTERVAL_MS || 60000);
  setInterval(tick, interval);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
