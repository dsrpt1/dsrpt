export const POLICY_MANAGER_ADDRESS =
  process.env.NEXT_PUBLIC_POLICY_MANAGER as `0x${string}`;
export const LIQUIDITY_POOL_ADDRESS =
  process.env.NEXT_PUBLIC_LIQUIDITY_POOL as `0x${string}`;
export const DEPEG_ADAPTER_ADDRESS =
  process.env.NEXT_PUBLIC_DEPEG_ADAPTER as `0x${string}`;
export const USDC_ADDRESS =
  process.env.NEXT_PUBLIC_USDC as `0x${string}`;

// this matches the PolicyManager you deployed (the minimal one)
export const policyManagerAbi = [
  {
    type: 'function',
    name: 'asset',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address', name: '' }],
  },
  {
    type: 'function',
    name: 'pool',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address', name: '' }],
  },
  {
    type: 'function',
    name: 'curve',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address', name: '' }],
  },
  {
    type: 'function',
    name: 'oracle',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address', name: '' }],
  },
  {
    type: 'function',
    name: 'setOracle',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'address', name: 'newOracle' }],
    outputs: [],
  },
] as const;
