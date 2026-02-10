import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '還錢好過年',
  description: '記錄發票明細並自動計算多人分擔金額',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-TW" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  )
}

