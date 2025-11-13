// Updated HazardCurveEngine ABI - with Ownable and validation
export const hazardCurveAbi = [
  // ===== State Variables (public getters) =====
  {
    inputs: [],
    name: 'owner',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ name: 'id', type: 'bytes32' }],
    name: 'curves',
    outputs: [
      { name: 'baseProbPerDay', type: 'uint256' },
      { name: 'slopePerDay', type: 'uint256' },
      { name: 'minPremiumBps', type: 'uint256' }
    ],
    stateMutability: 'view',
    type: 'function'
  },

  // ===== Admin Functions =====
  {
    inputs: [
      { name: 'id', type: 'bytes32' },
      {
        name: 'c',
        type: 'tuple',
        components: [
          { name: 'baseProbPerDay', type: 'uint256' },
          { name: 'slopePerDay', type: 'uint256' },
          { name: 'minPremiumBps', type: 'uint256' }
        ]
      }
    ],
    name: 'setCurve',
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

  // ===== View Functions =====
  {
    inputs: [
      { name: 'id', type: 'bytes32' },
      { name: 'coverage', type: 'uint256' },
      { name: 'tenorDays', type: 'uint256' }
    ],
    name: 'premiumOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ name: 'id', type: 'bytes32' }],
    name: 'getCurve',
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'baseProbPerDay', type: 'uint256' },
          { name: 'slopePerDay', type: 'uint256' },
          { name: 'minPremiumBps', type: 'uint256' }
        ]
      }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ name: 'id', type: 'bytes32' }],
    name: 'curveExists',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function'
  },

  // ===== Events =====
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'id', type: 'bytes32' },
      { indexed: false, name: 'baseProbPerDay', type: 'uint256' },
      { indexed: false, name: 'slopePerDay', type: 'uint256' },
      { indexed: false, name: 'minPremiumBps', type: 'uint256' }
    ],
    name: 'CurveUpdated',
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
    name: 'CurveNotFound',
    inputs: [{ name: 'id', type: 'bytes32' }]
  },
  {
    type: 'error',
    name: 'InvalidCurveParams',
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
