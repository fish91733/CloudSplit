/**
 * 計算分擔金額
 * @param unitPrice 單價
 * @param shareCount 分擔人數
 * @param discountRatio 折扣比（預設 1.0）
 * @param discountAdjustment 折扣調整金額（預設 0）
 * @returns 每人分擔金額
 */
export function calculateShareAmount(
  unitPrice: number,
  shareCount: number,
  discountRatio: number = 1.0,
  discountAdjustment: number = 0
): number {
  if (shareCount === 0) return 0
  // 公式：(單價 * 折扣比 + 折扣調整) / 參與人數
  return (unitPrice * discountRatio + discountAdjustment) / shareCount
}

/**
 * 格式化金額顯示
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount)
}

