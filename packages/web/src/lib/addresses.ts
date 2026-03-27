// DSRPT Protocol Contract Addresses - Base Mainnet
// Deployed: 2026-03-27 (Block 43922285)

export const ADDRESSES = {
  base: {
    // Core Assets
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',

    // DSRPT Protocol Contracts (production deployment)
    oracleAggregator: '0xB203E42D84B70a60E3032F5Ed661C50cc7E9e3Cb',
    treasuryManager: '0x540C8c83F8173AD3835eefeaAdb91fe86E7189e2',
    hazardEngine: '0x43634429c8Ff62D9808558cb150a76D32140Ba0e',
    policyManager: '0xc1D0eeA34dAE0A76A7972412f802C4EA720C9B36',
    keepersAdapter: '0x8A7149E93a5309f2B5Ca5BcdA8a1D5645026F1C8',
    oracleAdapter: '0x0f43Ca50CFdFb916b2782b9cF878e3F422559524',

    // Chainlink Oracle
    chainlinkUsdcUsd: '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B',

    // Keeper/Ops Wallet
    keeper: '0x680d25d5EdF4ccEC25800e0FA5B1C28D377703C0',

    // Legacy aliases (for backward compatibility)
    curve: '0x43634429c8Ff62D9808558cb150a76D32140Ba0e',  // hazardEngine
    pool: '0x540C8c83F8173AD3835eefeaAdb91fe86E7189e2',   // treasuryManager
    pm: '0xc1D0eeA34dAE0A76A7972412f802C4EA720C9B36',     // policyManager
    adapter: '0xB203E42D84B70a60E3032F5Ed661C50cc7E9e3Cb', // oracleAggregator
  },
} as const

// Peril IDs
export const PERIL_IDS = {
  USDC_DEPEG: '0x6cdb2b1f320420e8bcd2f00c91695a104bd6066ad93d0ccbd0195a603747ed1f',
} as const

// Tranche IDs for Treasury
export const TRANCHE_IDS = {
  JUNIOR: 0,
  MEZZANINE: 1,
  SENIOR: 2,
} as const
