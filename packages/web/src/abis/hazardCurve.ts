export const hazardCurveAbi = [
  {
    type: "function",
    name: "premiumOf",
    stateMutability: "view",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "coverage", type: "uint256" },
      { name: "tenorDays", type: "uint256" }
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "curves",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      { name: "baseProbPerDay", type: "uint256" },
      { name: "slopePerDay", type: "uint256" },
      { name: "minPremiumBps", type: "uint256" }
    ],
  },
  {
    type: "function",
    name: "setCurve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "bytes32" },
      {
        name: "c",
        type: "tuple",
        components: [
          { name: "baseProbPerDay", type: "uint256" },
          { name: "slopePerDay", type: "uint256" },
          { name: "minPremiumBps", type: "uint256" }
        ]
      }
    ],
    outputs: [],
  },
] as const;
