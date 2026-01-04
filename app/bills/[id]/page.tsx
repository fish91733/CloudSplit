import EditBillPageClient from './EditBillPageClient'

// 靜態導出時需要 generateStaticParams
// 返回一個預設參數，實際路由由客戶端處理
// 注意：不能使用 dynamicParams = true，因為它與 output: 'export' 不相容
export async function generateStaticParams() {
  // 返回一個預設 ID，實際的動態路由由客戶端處理
  return [{ id: 'placeholder' }]
}

export default function EditBillPage() {
  return <EditBillPageClient />
}
