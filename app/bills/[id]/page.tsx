'use client'

import { useParams } from 'next/navigation'
import BillEditor from '@/components/BillEditor'

export default function EditBillPage() {
  const params = useParams()
  const billId = params.id as string

  // 允許訪客模式查看發票明細（BillEditor 會處理編輯權限）
  return <BillEditor billId={billId} />
}
