export const ADDRESSES = {
  base: {
    usdc:   '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    curve:  '0x2D3680dc7f0f210bd440a83EcCAd92c4d1d290eB',
    pool:   '0x056CfB80C639BB817ce6050205ee4CFADfa81CbE',
    pm:     '0x0986d78f67d2540dc940a2D8232e3515Fb35B379',
    adapter:'0x40d2f7a6362ca11040103e35935fc941136C0Fce',
    keeper: process.env.NEXT_PUBLIC_KEEPER_EOA ?? '',
  },
} as const
