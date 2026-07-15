import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@comparador/db', '@comparador/core', '@comparador/providers'],
  // workspace packages use ESM ".js" import specifiers for ".ts" sources
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
    }
    return webpackConfig
  },
}

export default config
