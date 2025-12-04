// Contract addresses - configured via .env.local
// After redeployment, make sure .env.local has the NEW contract addresses
export const ADDRESSES = {
  base: {
    // Fixed addresses (never change)
    usdc:   process.env.NEXT_PUBLIC_USDC ?? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    keeper: process.env.NEXT_PUBLIC_KEEPER ?? '0x981306c1aE8829F07444249Ce2D8800F89113B74',

    // Deployed contract addresses (update after redeployment)
    curve:  process.env.NEXT_PUBLIC_HAZARD_CURVE!,
    pool:   process.env.NEXT_PUBLIC_LIQUIDITY_POOL!,
    pm:     process.env.NEXT_PUBLIC_POLICY_MANAGER!,
    adapter: process.env.NEXT_PUBLIC_DEPEG_ADAPTER!,
  },
} as const
