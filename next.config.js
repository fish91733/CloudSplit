/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 開發模式下不使用靜態導出，避免動態路由問題
  // 只在生產構建時使用 output: 'export'
  ...(process.env.NODE_ENV === 'production' && {
    output: 'export', // 啟用靜態導出，用於 GitHub Pages
  }),
  images: {
    unoptimized: true, // GitHub Pages 不支援圖片優化
  },
  // GitHub Pages 子路徑配置
  basePath: process.env.NODE_ENV === 'production' ? '/CloudSplit' : '',
  assetPrefix: process.env.NODE_ENV === 'production' ? '/CloudSplit' : '',
}

module.exports = nextConfig

