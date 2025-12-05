// packages/web/src/lib/health.ts

import {
  createPublicClient,
  http,
  formatUnits,
  isAddress,
  type Address,
} from "viem";
import { base } from "viem/chains";
import { ADDRESSES } from "@/lib/addresses";

/* ──────────────────────────────────────────────────────────────────────────────
 * Minimal ABIs
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

const ADAPTER_ABI = [
  {
    type: "function",
    name: "keeper",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "threshold1e8",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "maxStale",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

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
    name: "pool",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "oracle",
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

/* ──────────────────────────────────────────────────────────────────────────────
 * Main health check
 * ────────────────────────────────────────────────────────────────────────────*/
export async function runHealthCheck(): Promise<HealthReport> {
  const A = ADDRESSES.base;

  // Basic address sanity
  const addrValidity: HealthRow[] = [
    ["USDC", A.usdc],
    ["Curve", A.curve],
    ["Pool", A.pool],
    ["PolicyManager", A.pm],
    ["Adapter", A.adapter],
  ].map(([label, v]) => ({
    label: `${label} address`,
    value: String(v),
    badge: isAddress(v as Address) ? "ok" : "error",
    hint: isAddress(v as Address) ? undefined : "Not a valid address",
  }));

  // On-chain probes
  const [pmCode, poolCode, adapterCode] = await Promise.all([
    codeSize(A.pm as Address),
    codeSize(A.pool as Address),
    codeSize(A.adapter as Address),
  ]);

  const rows: HealthRow[] = [
    {
      label: "PolicyManager code",
      value: pmCode > 0 ? "present" : "empty",
      badge: pmCode > 0 ? "ok" : "error",
    },
    {
      label: "Pool code",
      value: poolCode > 0 ? "present" : "empty",
      badge: poolCode > 0 ? "ok" : "error",
    },
    {
      label: "Adapter code",
      value: adapterCode > 0 ? "present" : "empty",
      badge: adapterCode > 0 ? "ok" : "error",
    },
  ];

  // Read PM wiring (asset / pool / oracle) - sequential with delays to avoid rate limits
  try {
    await delay(200);
    const asset = await withRetry(() =>
      client.readContract({
        address: A.pm as Address,
        abi: POLICY_MANAGER_ABI,
        functionName: "asset",
      })
    );
    await delay(200);
    const pool = await withRetry(() =>
      client.readContract({
        address: A.pm as Address,
        abi: POLICY_MANAGER_ABI,
        functionName: "pool",
      })
    );
    await delay(200);
    const oracle = await withRetry(() =>
      client.readContract({
        address: A.pm as Address,
        abi: POLICY_MANAGER_ABI,
        functionName: "oracle",
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
        label: "PM.pool",
        value: pool,
        badge: pool.toLowerCase() === A.pool.toLowerCase() ? "ok" : "warn",
      },
      {
        label: "PM.oracle",
        value: oracle,
        badge:
          oracle.toLowerCase() === A.adapter.toLowerCase() ? "ok" : "warn",
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

  // Pool USDC balance
  try {
    const bal = await erc20Balance(A.usdc as Address, A.pool as Address);
    rows.push({
      label: "Pool USDC balance",
      value: `${bal.formatted} USDC`,
      badge: "ok",
    });
  } catch (e: unknown) {
    const hint = errorMessage(e);
    const isRateLimit = hint.includes("rate limit") || hint.includes("429");
    rows.push({
      label: "Pool USDC balance",
      value: "unreadable",
      badge: "warn",
      hint: isRateLimit ? "RPC rate limited - try again shortly" : hint,
    });
  }

  // Adapter params - read sequentially with delays to avoid rate limits
  try {
    await delay(200);
    const keeper = await withRetry(() =>
      client.readContract({
        address: A.adapter as Address,
        abi: ADAPTER_ABI,
        functionName: "keeper",
      })
    );
    await delay(200);
    const threshold1e8 = await withRetry(() =>
      client.readContract({
        address: A.adapter as Address,
        abi: ADAPTER_ABI,
        functionName: "threshold1e8",
      })
    );
    await delay(200);
    const maxStale = await withRetry(() =>
      client.readContract({
        address: A.adapter as Address,
        abi: ADAPTER_ABI,
        functionName: "maxStale",
      })
    );

    const keeperBadge: Badge =
      A.keeper && keeper.toLowerCase() === A.keeper.toLowerCase()
        ? "ok"
        : "warn";

    rows.push(
      {
        label: "Adapter.keeper",
        value: keeper,
        badge: keeperBadge,
        hint:
          keeperBadge === "warn" ? "Differs from expected" : undefined,
      },
      {
        label: "Adapter.threshold1e8",
        value: `${Number(threshold1e8) / 1e8}`,
        badge: "ok",
        hint: "USD peg threshold",
      },
      {
        label: "Adapter.maxStale",
        value: `${maxStale} s`,
        badge: Number(maxStale) <= 3600 ? "ok" : "warn",
      },
    );
  } catch (e: unknown) {
    const hint = errorMessage(e);
    const isRateLimit = hint.includes("rate limit") || hint.includes("429");
    rows.push({
      label: "Adapter params",
      value: "unreadable",
      badge: "warn",
      hint: isRateLimit ? "RPC rate limited - try again shortly" : hint,
    });
  }

  // Keeper balance (optional visual)
  try {
    if (A.keeper && isAddress(A.keeper as Address)) {
      const bal = await withRetry(() =>
        client.getBalance({ address: A.keeper as Address })
      );
      const eth = Number(formatUnits(bal, 18));
      rows.push({
        label: "Keeper ETH",
        value: `${eth.toFixed(6)} ETH`,
        badge: eth > 0.001 ? "ok" : eth > 0 ? "warn" : "error",
        hint: eth > 0.001 ? undefined : "Top up recommended",
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
