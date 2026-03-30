// Stripe subscription tier definitions
// Tier is stored in Clerk user metadata after Stripe webhook confirms payment

export type SubscriptionTier = 'free' | 'pro' | 'enterprise'

export const TIER_LIMITS = {
  free: {
    label: 'Free',
    price: 0,
    historyDays: 7,
    assets: ['USDC'],
    apiAccess: false,
    alertsAccess: false,
    realtimeCharts: false,
    rateLimit: 10,       // requests per minute
  },
  pro: {
    label: 'Pro',
    price: 99,
    historyDays: 90,
    assets: ['USDC', 'USDT', 'DAI', 'FDUSD', 'PYUSD'],
    apiAccess: true,
    alertsAccess: true,
    realtimeCharts: true,
    rateLimit: 60,
  },
  enterprise: {
    label: 'Enterprise',
    price: null,           // custom pricing
    historyDays: 365,
    assets: '*' as const,  // all assets
    apiAccess: true,
    alertsAccess: true,
    realtimeCharts: true,
    rateLimit: 300,
  },
} as const

export function getUserTier(publicMetadata: Record<string, unknown>): SubscriptionTier {
  const tier = publicMetadata?.subscription_tier as string | undefined
  if (tier === 'pro' || tier === 'enterprise') return tier
  return 'free'
}

export function canAccessAsset(tier: SubscriptionTier, asset: string): boolean {
  const limits = TIER_LIMITS[tier]
  if (limits.assets === '*') return true
  return (limits.assets as readonly string[]).includes(asset)
}

export function getHistoryLimit(tier: SubscriptionTier): number {
  return TIER_LIMITS[tier].historyDays
}
