import { Suspense } from 'react'
import EditBillPageClient from './EditBillPageClient'

// 靜態導出時需要 generateStaticParams，但我們無法在構建時訪問資料庫
// 返回空陣列，讓客戶端路由處理動態參數
export async function generateStaticParams() {
  return []
}

export const dynamicParams = true

export default function EditBillPage() {
  return (
    <Suspense fallback={<div>載入中...</div>}>
      <EditBillPageClient />
    </Suspense>
  )
}
