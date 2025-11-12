'use client'
import { ConnectButton } from '@rainbow-me/rainbowkit'

export default function Header() {
  return (
    <header className="relative border-b border-dsrpt-cyan-primary/20 bg-dsrpt-gray-900/80 backdrop-blur-sm">
      {/* Top accent line */}
      <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-dsrpt-cyan-primary to-transparent opacity-50" />

      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Logo and branding */}
          <div className="flex items-center gap-4">
            <div className="relative">
              {/* Cyber logo box */}
              <div className="w-12 h-12 bg-dsrpt-gray-800 border-2 border-dsrpt-cyan-primary clip-corner-tr flex items-center justify-center shadow-cyan-md">
                <div className="text-dsrpt-cyan-primary font-bold text-xl">D</div>
              </div>
              {/* Pulse effect */}
              <div className="absolute inset-0 bg-dsrpt-cyan-primary/20 clip-corner-tr animate-pulse-slow" />
            </div>

            <div>
              <h1 className="text-2xl font-bold text-dsrpt-cyan-primary text-glow uppercase tracking-wider">
                DSRPT.FINANCE
              </h1>
              <div className="text-xs text-dsrpt-cyan-secondary font-mono uppercase tracking-wider">
                PARAMETRIC RISK PROTOCOL
              </div>
            </div>
          </div>

          {/* Status and wallet */}
          <div className="flex items-center gap-4">
            {/* Network indicator */}
            <div className="hidden md:flex items-center gap-2 px-3 py-2 bg-dsrpt-gray-800 border border-dsrpt-cyan-primary/30 rounded">
              <div className="w-2 h-2 bg-dsrpt-success rounded-full animate-pulse-slow shadow-cyan-sm" />
              <span className="text-xs text-dsrpt-cyan-primary font-mono uppercase tracking-wider">
                BASE
              </span>
            </div>

            {/* Wallet connection */}
            <div className="cyber-wallet-button">
              <ConnectButton />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom glow effect */}
      <div className="absolute bottom-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-dsrpt-cyan-primary/30 to-transparent" />
    </header>
  )
}
