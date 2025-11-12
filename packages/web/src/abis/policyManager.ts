// Complete PolicyManager ABI
export const policyManagerAbi = [
  // View functions
  {
    inputs: [],
    name: 'asset',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'pool',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'oracle',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'nextPolicyId',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ name: 'id', type: 'uint256' }],
    name: 'policies',
    outputs: [
      { name: 'buyer', type: 'address' },
      { name: 'payout', type: 'uint256' },
      { name: 'premium', type: 'uint256' },
      { name: 'startTs', type: 'uint256' },
      { name: 'endTs', type: 'uint256' },
      { name: 'resolved', type: 'bool' }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  // Write functions
  {
    inputs: [
      { name: 'premium', type: 'uint256' },
      { name: 'payout', type: 'uint256' },
      { name: 'duration', type: 'uint256' }
    ],
    name: 'createPolicy',
    outputs: [{ name: 'id', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [{ name: 'id', type: 'uint256' }],
    name: 'resolve',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [{ name: '_oracle', type: 'address' }],
    name: 'setOracle',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'id', type: 'uint256' },
      { indexed: true, name: 'buyer', type: 'address' },
      { indexed: false, name: 'premium', type: 'uint256' },
      { indexed: false, name: 'payout', type: 'uint256' },
      { indexed: false, name: 'startTs', type: 'uint256' },
      { indexed: false, name: 'endTs', type: 'uint256' }
    ],
    name: 'PolicyCreated',
    type: 'event'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'id', type: 'uint256' },
      { indexed: false, name: 'paid', type: 'bool' }
    ],
    name: 'PolicyResolved',
    type: 'event'
  }
] as const;
