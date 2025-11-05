'use client'
import { ConnectButton } from '@rainbow-me/rainbowkit'

export default function Header() {
  return (
    <div className="p-4 border-b flex items-center justify-between">
      <div className="text-lg font-semibold">DSRPT MVP</div>
      <ConnectButton />
    </div>
  )
}
