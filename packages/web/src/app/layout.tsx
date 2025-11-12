'use client'
import { ReactNode } from 'react'
import { WagmiProvider } from 'wagmi'
import { config } from '@/lib/wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit'
import '@rainbow-me/rainbowkit/styles.css'
import './globals.css'
import Header from '@/components/header'

const queryClient = new QueryClient()

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <title>DSRPT.FINANCE — Parametric Risk Protocol</title>
        <meta name="description" content="Decentralized parametric insurance protocol on Base" />
      </head>
      <body>
        <WagmiProvider config={config}>
          <QueryClientProvider client={queryClient}>
            <RainbowKitProvider
              theme={darkTheme({
                accentColor: '#00ffff',
                accentColorForeground: '#000000',
                borderRadius: 'small',
                fontStack: 'system',
                overlayBlur: 'small',
              })}
            >
              <Header />
              {children}
            </RainbowKitProvider>
          </QueryClientProvider>
        </WagmiProvider>
      </body>
    </html>
  )
}
