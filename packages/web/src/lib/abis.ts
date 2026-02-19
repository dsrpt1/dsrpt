// DSRPT Protocol Contract ABIs
// Updated for new patent-ready architecture

// ============ DsrptHazardEngine ABI ============
export const HAZARD_ENGINE_ABI = [
  {
    type: 'function',
    name: 'quotePremium',
    stateMutability: 'view',
    inputs: [
      { name: 'perilId', type: 'bytes32' },
      { name: 'tenorDays', type: 'uint256' },
      { name: 'limitUSD', type: 'uint256' },
    ],
    outputs: [{ name: 'premiumUSD', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'quotePremiumDetailed',
    stateMutability: 'view',
    inputs: [
      { name: 'perilId', type: 'bytes32' },
      { name: 'tenorDays', type: 'uint256' },
      { name: 'limitUSD', type: 'uint256' },
    ],
    outputs: [
      { name: 'baseEL', type: 'uint256' },
      { name: 'marketMultiplier', type: 'uint256' },
      { name: 'bookMultiplier', type: 'uint256' },
      { name: 'finalPremium', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'quoteDailyPremium',
    stateMutability: 'view',
    inputs: [
      { name: 'perilId', type: 'bytes32' },
      { name: 'coveredBalance', type: 'uint256' },
    ],
    outputs: [{ name: 'dailyPremium', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getCurrentRegime',
    stateMutability: 'view',
    inputs: [{ name: 'perilId', type: 'bytes32' }],
    outputs: [{ name: 'regime', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'getOracleState',
    stateMutability: 'view',
    inputs: [{ name: 'perilId', type: 'bytes32' }],
    outputs: [
      {
        name: 'state',
        type: 'tuple',
        components: [
          { name: 'updatedAt', type: 'uint32' },
          { name: 'pegDevBps', type: 'uint16' },
          { name: 'volBps', type: 'uint16' },
          { name: 'disagreementBps', type: 'uint16' },
          { name: 'shockFlag', type: 'uint8' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'getPortfolioState',
    stateMutability: 'view',
    inputs: [{ name: 'perilId', type: 'bytes32' }],
    outputs: [
      {
        name: 'state',
        type: 'tuple',
        components: [
          { name: 'utilizationBps', type: 'uint16' },
          { name: 'capitalRatioBps', type: 'uint16' },
          { name: 'perilConcentrationBps', type: 'uint16' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'calculatePayout',
    stateMutability: 'view',
    inputs: [
      { name: 'perilId', type: 'bytes32' },
      { name: 'policyLimit', type: 'uint256' },
      { name: 'depegBps', type: 'uint256' },
      { name: 'durationHours', type: 'uint256' },
    ],
    outputs: [{ name: 'payout', type: 'uint256' }],
  },
] as const

// ============ DsrptPolicyManager ABI ============
export const POLICY_MANAGER_ABI = [
  {
    type: 'function',
    name: 'issueFixedPolicy',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'perilId', type: 'bytes32' },
      { name: 'insuredAddress', type: 'address' },
      { name: 'coverageLimit', type: 'uint256' },
      { name: 'durationDays', type: 'uint32' },
    ],
    outputs: [{ name: 'policyId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'issueStreamingPolicy',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'perilId', type: 'bytes32' },
      { name: 'insuredAddress', type: 'address' },
      { name: 'maxCoverage', type: 'uint256' },
      { name: 'durationDays', type: 'uint32' },
    ],
    outputs: [{ name: 'policyId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getPolicy',
    stateMutability: 'view',
    inputs: [{ name: 'policyId', type: 'uint256' }],
    outputs: [
      {
        name: 'policy',
        type: 'tuple',
        components: [
          { name: 'policyId', type: 'uint256' },
          { name: 'perilId', type: 'bytes32' },
          { name: 'insuredAddress', type: 'address' },
          { name: 'coverageLimit', type: 'uint256' },
          { name: 'premiumPaid', type: 'uint256' },
          { name: 'premiumAccrued', type: 'uint256' },
          { name: 'escrowBalance', type: 'uint256' },
          { name: 'startTime', type: 'uint64' },
          { name: 'endTime', type: 'uint64' },
          { name: 'lastCheckpoint', type: 'uint64' },
          { name: 'status', type: 'uint8' },
          { name: 'premiumModel', type: 'uint8' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'submitClaim',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'policyId', type: 'uint256' },
      { name: 'depegBps', type: 'uint256' },
      { name: 'durationHours', type: 'uint256' },
    ],
    outputs: [{ name: 'claimId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'nextPolicyId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getUserPolicies',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: 'policyIds', type: 'uint256[]' }],
  },
  {
    type: 'event',
    name: 'PolicyIssued',
    inputs: [
      { name: 'policyId', type: 'uint256', indexed: true },
      { name: 'insuredAddress', type: 'address', indexed: true },
      { name: 'perilId', type: 'bytes32', indexed: true },
      { name: 'coverageLimit', type: 'uint256', indexed: false },
      { name: 'premium', type: 'uint256', indexed: false },
      { name: 'premiumModel', type: 'uint8', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ClaimSubmitted',
    inputs: [
      { name: 'claimId', type: 'uint256', indexed: true },
      { name: 'policyId', type: 'uint256', indexed: true },
      { name: 'payout', type: 'uint256', indexed: false },
    ],
  },
] as const

// ============ DsrptTreasuryManager ABI ============
export const TREASURY_MANAGER_ABI = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'trancheId', type: 'uint8' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'requestWithdrawal',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'trancheId', type: 'uint8' },
      { name: 'shares', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'executeWithdrawal',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'trancheId', type: 'uint8' }],
    outputs: [{ name: 'amount', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getPoolStats',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'totalAssets', type: 'uint256' },
      { name: 'totalLiabilities', type: 'uint256' },
      { name: 'availableCapital', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'getTrancheConfig',
    stateMutability: 'view',
    inputs: [{ name: 'trancheId', type: 'uint8' }],
    outputs: [
      {
        name: 'config',
        type: 'tuple',
        components: [
          { name: 'trancheId', type: 'uint8' },
          { name: 'targetYieldBps', type: 'uint16' },
          { name: 'poolShareBps', type: 'uint16' },
          { name: 'capacity', type: 'uint256' },
          { name: 'deployed', type: 'uint256' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'getDepositorPosition',
    stateMutability: 'view',
    inputs: [
      { name: 'depositor', type: 'address' },
      { name: 'trancheId', type: 'uint8' },
    ],
    outputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'value', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'asset',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'event',
    name: 'CapitalDeposited',
    inputs: [
      { name: 'depositor', type: 'address', indexed: true },
      { name: 'trancheId', type: 'uint8', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'shares', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'WithdrawalRequested',
    inputs: [
      { name: 'depositor', type: 'address', indexed: true },
      { name: 'trancheId', type: 'uint8', indexed: true },
      { name: 'shares', type: 'uint256', indexed: false },
      { name: 'availableAt', type: 'uint32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'WithdrawalExecuted',
    inputs: [
      { name: 'depositor', type: 'address', indexed: true },
      { name: 'trancheId', type: 'uint8', indexed: true },
      { name: 'shares', type: 'uint256', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const

// ============ OracleAggregator ABI ============
export const ORACLE_AGGREGATOR_ABI = [
  {
    type: 'function',
    name: 'getLatestSnapshot',
    stateMutability: 'view',
    inputs: [{ name: 'perilId', type: 'bytes32' }],
    outputs: [
      {
        name: 'snapshot',
        type: 'tuple',
        components: [
          { name: 'timestamp', type: 'uint32' },
          { name: 'medianPrice', type: 'uint128' },
          { name: 'minPrice', type: 'uint128' },
          { name: 'maxPrice', type: 'uint128' },
          { name: 'feedCount', type: 'uint8' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'computeOracleState',
    stateMutability: 'view',
    inputs: [{ name: 'perilId', type: 'bytes32' }],
    outputs: [
      {
        name: 'state',
        type: 'tuple',
        components: [
          { name: 'updatedAt', type: 'uint32' },
          { name: 'pegDevBps', type: 'uint16' },
          { name: 'volBps', type: 'uint16' },
          { name: 'disagreementBps', type: 'uint16' },
          { name: 'shockFlag', type: 'uint8' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'getVolatilityConfig',
    stateMutability: 'view',
    inputs: [{ name: 'perilId', type: 'bytes32' }],
    outputs: [
      {
        name: 'config',
        type: 'tuple',
        components: [
          { name: 'lookbackPeriods', type: 'uint8' },
          { name: 'ewmaAlpha', type: 'uint16' },
          { name: 'shockThresholdBps', type: 'uint16' },
        ],
      },
    ],
  },
] as const

// ============ ERC20 ABI ============
export const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'symbol',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const

// ============ Legacy Aliases ============
// For backward compatibility with existing code
export const HAZARD_CURVE_ABI = HAZARD_ENGINE_ABI
export const LIQUIDITY_POOL_ABI = TREASURY_MANAGER_ABI
