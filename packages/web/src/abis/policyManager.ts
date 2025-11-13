// Updated PolicyManager ABI - with Ownable, ReentrancyGuard, and new functions
export const policyManagerAbi = [
  // ===== State Variables (public getters) =====
  {
    inputs: [],
    name: 'asset',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'pool',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'curve',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'oracle',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'keeper',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'nextPolicyId',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'curveId',
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'minPremiumBps',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'owner',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },

  // ===== Policy Mapping Getter =====
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

  // ===== Admin Functions =====
  {
    inputs: [{ name: '_oracle', type: 'address' }],
    name: 'setOracle',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [{ name: '_keeper', type: 'address' }],
    name: 'setKeeper',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [{ name: '_curveId', type: 'bytes32' }],
    name: 'setCurveId',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [{ name: '_minBps', type: 'uint256' }],
    name: 'setMinPremiumBps',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [{ name: 'newOwner', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },

  // ===== Core Functions =====
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

  // ===== View Helper Functions =====
  {
    inputs: [{ name: 'id', type: 'uint256' }],
    name: 'getPolicy',
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'buyer', type: 'address' },
          { name: 'payout', type: 'uint256' },
          { name: 'premium', type: 'uint256' },
          { name: 'startTs', type: 'uint256' },
          { name: 'endTs', type: 'uint256' },
          { name: 'resolved', type: 'bool' }
        ]
      }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ name: 'id', type: 'uint256' }],
    name: 'isPolicyActive',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'getTotalPolicies',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },

  // ===== Events =====
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
      { indexed: false, name: 'paid', type: 'bool' },
      { indexed: false, name: 'payoutAmount', type: 'uint256' }
    ],
    name: 'PolicyResolved',
    type: 'event'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'oracle', type: 'address' }
    ],
    name: 'OracleUpdated',
    type: 'event'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'keeper', type: 'address' }
    ],
    name: 'KeeperUpdated',
    type: 'event'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'curveId', type: 'bytes32' }
    ],
    name: 'CurveIdUpdated',
    type: 'event'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'previousOwner', type: 'address' },
      { indexed: true, name: 'newOwner', type: 'address' }
    ],
    name: 'OwnershipTransferred',
    type: 'event'
  },

  // ===== Custom Errors =====
  {
    type: 'error',
    name: 'InsufficientPremium',
    inputs: [
      { name: 'provided', type: 'uint256' },
      { name: 'required', type: 'uint256' }
    ]
  },
  {
    type: 'error',
    name: 'OracleNotSet',
    inputs: []
  },
  {
    type: 'error',
    name: 'PolicyExpired',
    inputs: []
  },
  {
    type: 'error',
    name: 'PolicyNotExpired',
    inputs: []
  },
  {
    type: 'error',
    name: 'PolicyAlreadyResolved',
    inputs: []
  },
  {
    type: 'error',
    name: 'NotKeeper',
    inputs: []
  },
  {
    type: 'error',
    name: 'OwnableUnauthorizedAccount',
    inputs: [{ name: 'account', type: 'address' }]
  },
  {
    type: 'error',
    name: 'OwnableInvalidOwner',
    inputs: [{ name: 'owner', type: 'address' }]
  }
] as const;
