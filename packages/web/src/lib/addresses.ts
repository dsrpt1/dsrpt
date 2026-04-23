// DSRPT Protocol Contract Addresses - Base Mainnet
// Deployed: 2026-03-27 (Block 43922285)

export const ADDRESSES = {
  base: {
    // Core Assets
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    usdt: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',

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
  USDT_DEPEG: '0x073146c315d13913647c4f8d0fe5ef4976515fef6adcdef2261fdb55bf15b16a',
} as const

// Contagion contracts (deployed 2026-04-23, block 45077821)
export const CONTAGION = {
  base: {
    registry:       '0xcD42695b7D26e6251a12199087A0f8bE49c7e82b',
    oracle:         '0xCe12014B3A3CA1c2D9a2cD0d23BAd94a1ead1E85',
    trigger:        '0x8cb4756ce55a90495468C13A86f481a05A613930',
    policyManager:  '0x5A36e58b83B4667322921759ffbC5c94d0a8Bb13',
    pricingEngine:  '0xCe114aEB65c7df1798Da6f5071a8B6BF942dDC10',

    // Wrapped assets
    rsETH:          '0xC5DbB6F24F97e5Bc0cB0A48a0254D42070898b52',
  },
} as const

// Contagion peril IDs
export const CONTAGION_PERILS = {
  RSETH:  '0x7ded8ed39b342f0fcc04c181f9b970f5f519fb15e537b23d5bdfe757a1a88ee1',
  WSTETH: '', // set after deploy
  CBETH:  '', // set after deploy
  RETH:   '', // set after deploy
  WEETH:  '', // set after deploy
} as const

export const CONTAGION_ASSETS = [
  { symbol: 'rsETH',  perilId: CONTAGION_PERILS.RSETH, source: 'Kelp DAO',    verifiers: '2-of-3' },
] as const

// Tranche IDs for Treasury
export const TRANCHE_IDS = {
  JUNIOR: 0,
  MEZZANINE: 1,
  SENIOR: 2,
} as const
