// packages/web/src/lib/wagmi.ts
import { createConfig, http } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { base } from 'wagmi/chains'

export const config = createConfig({
  chains: [base],
  connectors: [injected()],
  transports: {
    [base.id]: http(process.env.NEXT_PUBLIC_RPC_URL || 'https://mainnet.base.org'),
  },
  ssr: true,
})
