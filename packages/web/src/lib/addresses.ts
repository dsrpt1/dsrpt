// DSRPT Protocol Contract Addresses - Base Mainnet
// Deployed: 2024

export const ADDRESSES = {
  base: {
    // Core Assets
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',

    // DSRPT Protocol Contracts
    oracleAggregator: '0x773515FD8BD90620d4E9Db7a7DecEc6BA6eb83a3',
    treasuryManager: '0xA659B64Dcb089f12c6B5dB85Dd1c29068a5b8a37',
    hazardEngine: '0xf6d1a5107c8723bE3526972c4171968A724c50bF',
    policyManager: '0x277502A8a8763d2E83A747b030f7b67B1B90Dfa1',
    keepersAdapter: '0x112B36dB8d5e0Ab86174E71737d64A51591A6868',

    // Chainlink Oracle
    chainlinkUsdcUsd: '0x2489462e64Ea205386b7b8737609B3701047a77d',

    // Keeper/Ops Wallet (deployer address used in contract deployment)
    keeper: '0x981306c1aE8829F07444249Ce2D8800F89113B74',

    // Legacy aliases (for backward compatibility)
    curve: '0xf6d1a5107c8723bE3526972c4171968A724c50bF',  // hazardEngine
    pool: '0xA659B64Dcb089f12c6B5dB85Dd1c29068a5b8a37',   // treasuryManager
    pm: '0x277502A8a8763d2E83A747b030f7b67B1B90Dfa1',     // policyManager
    adapter: '0x773515FD8BD90620d4E9Db7a7DecEc6BA6eb83a3', // oracleAggregator
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
