import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Externalize problematic packages that don't work with Turbopack
  serverExternalPackages: [
    'pino',
    'pino-pretty',
    'thread-stream',
    'lokijs',
  ],
  // Turbopack config for Next.js 16+ (default bundler)
  turbopack: {
    resolveAlias: {
      // Stub out node modules for browser (WalletConnect compatibility)
      'pino-pretty': './empty-module.js',
      'lokijs': './empty-module.js',
      'encoding': './empty-module.js',
    },
  },
  // Webpack fallback (for local dev with --webpack flag)
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      encoding: false,
    };
    config.externals.push('pino-pretty', 'lokijs', 'encoding');
    return config;
  },
};

export default nextConfig;
