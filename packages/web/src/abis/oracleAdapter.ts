// Oracle Adapter ABI
export const oracleAdapterAbi = [
  {
    inputs: [],
    name: 'keeper',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'threshold1e8',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'maxStale',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ name: 'assetId', type: 'bytes32' }],
    name: 'latestPrice',
    outputs: [
      { name: 'price', type: 'int256' },
      { name: 'updatedAt', type: 'uint256' }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ name: 'policyId', type: 'bytes32' }],
    name: 'conditionMet',
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ name: 'policyId', type: 'bytes32' }],
    name: 'resolved',
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      { name: 'policyId', type: 'bytes32' },
      { name: 'met', type: 'bool' }
    ],
    name: 'setCondition',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  }
] as const;
