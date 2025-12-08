// Contract ABIs for DSRPT

export const LIQUIDITY_POOL_ABI = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amt', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amt', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'poolAssets',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'asset',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
] as const

export const POLICY_MANAGER_ABI = [
  {
    type: 'function',
    name: 'createPolicy',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'premium', type: 'uint256' },
      { name: 'payout', type: 'uint256' },
      { name: 'duration', type: 'uint256' },
    ],
    outputs: [{ name: 'id', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'nextPolicyId',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
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
      { name: 'resolved', type: 'bool' },
    ],
  },
  {
    type: 'event',
    name: 'PolicyCreated',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'buyer', type: 'address', indexed: true },
      { name: 'premium', type: 'uint256', indexed: false },
      { name: 'payout', type: 'uint256', indexed: false },
      { name: 'startTs', type: 'uint256', indexed: false },
      { name: 'endTs', type: 'uint256', indexed: false },
    ],
  },
] as const

export const HAZARD_CURVE_ABI = [
  {
    type: 'function',
    name: 'premiumOf',
    stateMutability: 'view',
    inputs: [
      { name: 'perilId', type: 'bytes32' },
      { name: 'coverage', type: 'uint256' },
      { name: 'tenorDays', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'quotePremium',
    stateMutability: 'view',
    inputs: [
      { name: 'perilId', type: 'bytes32' },
      { name: 'coverage', type: 'uint256' },
      { name: 'tenorDays', type: 'uint256' },
    ],
    outputs: [
      { name: 'premium', type: 'uint256' },
      { name: 'expectedLoss', type: 'uint256' },
      { name: 'multiplierBps', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'cumulativeHazard',
    stateMutability: 'pure',
    inputs: [
      { name: 'baseProbPerDay', type: 'uint256' },
      { name: 'slopePerDay', type: 'uint256' },
      { name: 'tenorDays', type: 'uint256' },
    ],
    outputs: [{ name: 'H', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'curves',
    stateMutability: 'view',
    inputs: [{ name: 'perilId', type: 'bytes32' }],
    outputs: [
      { name: 'baseProbPerDay', type: 'uint256' },
      { name: 'slopePerDay', type: 'uint256' },
      { name: 'minPremiumBps', type: 'uint16' },
      { name: 'maxMultiplierBps', type: 'uint16' },
      { name: 'pegThresholdBps', type: 'uint16' },
      { name: 'oracleStaleAfter', type: 'uint32' },
      { name: 'active', type: 'bool' },
    ],
  },
  {
    type: 'function',
    name: 'getCurve',
    stateMutability: 'view',
    inputs: [{ name: 'perilId', type: 'bytes32' }],
    outputs: [
      { name: 'baseProbPerDay', type: 'uint256' },
      { name: 'slopePerDay', type: 'uint256' },
      { name: 'minPremiumBps', type: 'uint16' },
      { name: 'maxMultiplierBps', type: 'uint16' },
      { name: 'pegThresholdBps', type: 'uint16' },
      { name: 'oracleStaleAfter', type: 'uint32' },
      { name: 'active', type: 'bool' },
    ],
  },
  {
    type: 'function',
    name: 'getRiskMultiplier',
    stateMutability: 'view',
    inputs: [{ name: 'perilId', type: 'bytes32' }],
    outputs: [{ name: 'multiplierBps', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'priceFeed',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'event',
    name: 'CurveSet',
    inputs: [
      { name: 'perilId', type: 'bytes32', indexed: true },
      { name: 'curve', type: 'tuple', indexed: false, components: [
        { name: 'baseProbPerDay', type: 'uint256' },
        { name: 'slopePerDay', type: 'uint256' },
        { name: 'minPremiumBps', type: 'uint16' },
        { name: 'maxMultiplierBps', type: 'uint16' },
        { name: 'pegThresholdBps', type: 'uint16' },
        { name: 'oracleStaleAfter', type: 'uint32' },
        { name: 'active', type: 'bool' },
      ]},
    ],
  },
  {
    type: 'event',
    name: 'PriceFeedSet',
    inputs: [
      { name: 'feed', type: 'address', indexed: true },
    ],
  },
] as const

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
] as const
