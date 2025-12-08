// packages/web/src/lib/health.ts

import {
  createPublicClient,
  http,
  formatUnits,
  isAddress,
  type Address,
} from "viem";
import { base } from "viem/chains";
import { ADDRESSES, PERIL_IDS } from "@/lib/addresses";

/* ──────────────────────────────────────────────────────────────────────────────
 * Minimal ABIs for new DSRPT contracts
 * ────────────────────────────────────────────────────────────────────────────*/
const ERC20_ABI = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

// OracleAggregator ABI
const ORACLE_AGGREGATOR_ABI = [
  {
    type: "function",
    name: "keeper",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "hazardEngine",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

// DsrptPolicyManager ABI
const POLICY_MANAGER_ABI = [
  {
    type: "function",
    name: "asset",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "hazardEngine",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "treasuryManager",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "keeper",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

// DsrptHazardEngine ABI
const HAZARD_ENGINE_ABI = [
  {
    type: "function",
    name: "getCurrentRegime",
    stateMutability: "view",
    inputs: [{ name: "perilId", type: "bytes32" }],
    outputs: [{ name: "regime", type: "uint8" }],
  },
  {
    type: "function",
    name: "keeper",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

// DsrptTreasuryManager ABI
const TREASURY_MANAGER_ABI = [
  {
    type: "function",
    name: "totalCapital",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "asset",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

/* ──────────────────────────────────────────────────────────────────────────────
 * Types
 * ────────────────────────────────────────────────────────────────────────────*/
export type Badge = "ok" | "warn" | "error";

export type HealthRow = {
  label: string;
  value: string;
  badge: Badge;
  hint?: string;
};

export type HealthReport = {
  chain: string;
  chainId: number;
  rows: HealthRow[];
};

/* ──────────────────────────────────────────────────────────────────────────────
 * Client
 * ────────────────────────────────────────────────────────────────────────────*/
const RPC =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_BASE_RPC) ||
  "https://mainnet.base.org";

const client = createPublicClient({
  chain: base,
  transport: http(RPC, { batch: true, retryCount: 3, retryDelay: 1000 }),
});

/* ──────────────────────────────────────────────────────────────────────────────
 * Retry helper with exponential backoff
 * ────────────────────────────────────────────────────────────────────────────*/
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 4,
  delayMs = 2000
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      const isRateLimit =
        e instanceof Error &&
        (e.message.includes("rate limit") || e.message.includes("429"));
      if (isRateLimit && i < retries - 1) {
        await delay(delayMs * Math.pow(2, i));
      } else if (i === retries - 1) {
        throw e;
      }
    }
  }
  throw lastError;
}

/* ──────────────────────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────────────────────*/
async function codeSize(addr: Address): Promise<number> {
  try {
    const code = await withRetry(() => client.getBytecode({ address: addr }));
    return (code?.length ?? 0) / 2;
  } catch {
    return 0;
  }
}

async function erc20Balance(token: Address, holder: Address) {
  const dec = await withRetry(() =>
    client.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "decimals",
    })
  );
  await delay(200);
  const bal = await withRetry(() =>
    client.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [holder],
    })
  );
  return { raw: bal, formatted: formatUnits(bal, dec) };
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "read failed";
}

const REGIME_LABELS = ["Calm", "Volatile", "Crisis"] as const;

/* ──────────────────────────────────────────────────────────────────────────────
 * Main health check
 * ────────────────────────────────────────────────────────────────────────────*/
export async function runHealthCheck(): Promise<HealthReport> {
  const A = ADDRESSES.base;

  // Basic address sanity
  const addrValidity: HealthRow[] = [
    ["USDC", A.usdc],
    ["HazardEngine", A.hazardEngine],
    ["TreasuryManager", A.treasuryManager],
    ["PolicyManager", A.policyManager],
    ["OracleAggregator", A.oracleAggregator],
    ["KeepersAdapter", A.keepersAdapter],
  ].map(([label, v]) => ({
    label: `${label} address`,
    value: String(v),
    badge: isAddress(v as Address) ? "ok" : "error",
    hint: isAddress(v as Address) ? undefined : "Not a valid address",
  }));

  // On-chain probes - check all 5 contracts
  const [pmCode, treasuryCode, hazardCode, oracleCode, keepersCode] = await Promise.all([
    codeSize(A.policyManager as Address),
    codeSize(A.treasuryManager as Address),
    codeSize(A.hazardEngine as Address),
    codeSize(A.oracleAggregator as Address),
    codeSize(A.keepersAdapter as Address),
  ]);

  const rows: HealthRow[] = [
    {
      label: "PolicyManager code",
      value: pmCode > 0 ? "present" : "empty",
      badge: pmCode > 0 ? "ok" : "error",
    },
    {
      label: "TreasuryManager code",
      value: treasuryCode > 0 ? "present" : "empty",
      badge: treasuryCode > 0 ? "ok" : "error",
    },
    {
      label: "HazardEngine code",
      value: hazardCode > 0 ? "present" : "empty",
      badge: hazardCode > 0 ? "ok" : "error",
    },
    {
      label: "OracleAggregator code",
      value: oracleCode > 0 ? "present" : "empty",
      badge: oracleCode > 0 ? "ok" : "error",
    },
    {
      label: "KeepersAdapter code",
      value: keepersCode > 0 ? "present" : "empty",
      badge: keepersCode > 0 ? "ok" : "error",
    },
  ];

  // Read PM wiring (asset / hazardEngine / treasuryManager)
  try {
    await delay(200);
    const asset = await withRetry(() =>
      client.readContract({
        address: A.policyManager as Address,
        abi: POLICY_MANAGER_ABI,
        functionName: "asset",
      })
    );
    await delay(200);
    const hazardEngine = await withRetry(() =>
      client.readContract({
        address: A.policyManager as Address,
        abi: POLICY_MANAGER_ABI,
        functionName: "hazardEngine",
      })
    );
    await delay(200);
    const treasuryManager = await withRetry(() =>
      client.readContract({
        address: A.policyManager as Address,
        abi: POLICY_MANAGER_ABI,
        functionName: "treasuryManager",
      })
    );

    rows.push(
      {
        label: "PM.asset",
        value: asset,
        badge: asset.toLowerCase() === A.usdc.toLowerCase() ? "ok" : "warn",
        hint: "Should be USDC",
      },
      {
        label: "PM.hazardEngine",
        value: hazardEngine,
        badge: hazardEngine.toLowerCase() === A.hazardEngine.toLowerCase() ? "ok" : "warn",
      },
      {
        label: "PM.treasuryManager",
        value: treasuryManager,
        badge: treasuryManager.toLowerCase() === A.treasuryManager.toLowerCase() ? "ok" : "warn",
      },
    );
  } catch (e: unknown) {
    const hint = errorMessage(e);
    const isRateLimit = hint.includes("rate limit") || hint.includes("429");
    rows.push({
      label: "PM wiring",
      value: "unreadable",
      badge: "error",
      hint: isRateLimit ? "RPC rate limited - try again shortly" : hint,
    });
  }

  // Treasury total capital
  try {
    await delay(200);
    const capital = await withRetry(() =>
      client.readContract({
        address: A.treasuryManager as Address,
        abi: TREASURY_MANAGER_ABI,
        functionName: "totalCapital",
      })
    );
    rows.push({
      label: "Treasury TVL",
      value: `${formatUnits(capital, 6)} USDC`,
      badge: "ok",
    });
  } catch (e: unknown) {
    const hint = errorMessage(e);
    const isRateLimit = hint.includes("rate limit") || hint.includes("429");
    rows.push({
      label: "Treasury TVL",
      value: "unreadable",
      badge: "warn",
      hint: isRateLimit ? "RPC rate limited - try again shortly" : hint,
    });
  }

  // HazardEngine current regime
  try {
    await delay(200);
    const regime = await withRetry(() =>
      client.readContract({
        address: A.hazardEngine as Address,
        abi: HAZARD_ENGINE_ABI,
        functionName: "getCurrentRegime",
        args: [PERIL_IDS.USDC_DEPEG as `0x${string}`],
      })
    );
    rows.push({
      label: "Market Regime",
      value: REGIME_LABELS[regime] || `Unknown (${regime})`,
      badge: regime === 0 ? "ok" : regime === 1 ? "warn" : "error",
      hint: regime === 0 ? "Normal conditions" : regime === 1 ? "Elevated risk" : "High risk",
    });
  } catch (e: unknown) {
    const hint = errorMessage(e);
    const isRateLimit = hint.includes("rate limit") || hint.includes("429");
    rows.push({
      label: "Market Regime",
      value: "unreadable",
      badge: "warn",
      hint: isRateLimit ? "RPC rate limited - try again shortly" : hint,
    });
  }

  // OracleAggregator keeper check
  try {
    await delay(200);
    const oracleKeeper = await withRetry(() =>
      client.readContract({
        address: A.oracleAggregator as Address,
        abi: ORACLE_AGGREGATOR_ABI,
        functionName: "keeper",
      })
    );

    const keeperBadge: Badge =
      A.keeper && oracleKeeper.toLowerCase() === A.keeper.toLowerCase()
        ? "ok"
        : "warn";

    rows.push({
      label: "Oracle.keeper",
      value: oracleKeeper,
      badge: keeperBadge,
      hint: keeperBadge === "warn" ? "Differs from expected" : undefined,
    });
  } catch (e: unknown) {
    const hint = errorMessage(e);
    const isRateLimit = hint.includes("rate limit") || hint.includes("429");
    rows.push({
      label: "Oracle params",
      value: "unreadable",
      badge: "warn",
      hint: isRateLimit ? "RPC rate limited - try again shortly" : hint,
    });
  }

  // Keeper ETH balance
  try {
    if (A.keeper && isAddress(A.keeper as Address)) {
      await delay(200);
      const bal = await withRetry(() =>
        client.getBalance({ address: A.keeper as Address })
      );
      const eth = Number(formatUnits(bal, 18));
      rows.push({
        label: "Keeper ETH",
        value: `${eth.toFixed(6)} ETH`,
        badge: eth > 0.01 ? "ok" : eth > 0 ? "warn" : "error",
        hint: eth > 0.01 ? undefined : "Top up recommended",
      });
    }
  } catch (e: unknown) {
    const hint = errorMessage(e);
    const isRateLimit = hint.includes("rate limit") || hint.includes("429");
    rows.push({
      label: "Keeper ETH",
      value: "unreadable",
      badge: "warn",
      hint: isRateLimit ? "RPC rate limited - try again shortly" : hint,
    });
  }

  const report: HealthReport = {
    chain: base.name,
    chainId: base.id,
    rows: [...addrValidity, ...rows],
  };
  return report;
}
