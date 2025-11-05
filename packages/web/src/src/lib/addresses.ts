export const ADDR = {
  POLICY_MANAGER: process.env.NEXT_PUBLIC_POLICY_MANAGER as `0x${string}`,
  LIQUIDITY_POOL: process.env.NEXT_PUBLIC_LIQUIDITY_POOL as `0x${string}`,
  DEPEG_ORACLE:   process.env.NEXT_PUBLIC_DEPEG_ORACLE   as `0x${string}`,
  CURVE_ENGINE:   process.env.NEXT_PUBLIC_CURVE_ENGINE   as `0x${string}`,
  CHAINLINK:      process.env.NEXT_PUBLIC_CHAINLINK_USDC_USD as `0x${string}`,
  USDC:           process.env.NEXT_PUBLIC_USDC as `0x${string}`,
}
