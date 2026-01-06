'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { format } from 'date-fns'
import { zhTW } from 'date-fns/locale'
import BillDetailModal from './BillDetailModal'

interface ParticipantSummary {
  participantName: string
  totalAmount: number
  details: PaymentDetail[]
}

interface PaymentDetail {
  billId: string
  billTitle: string
  billDate: string
  itemName: string
  itemId: string
  shareAmount: number
}

interface GroupedDetail {
  billId: string
  billTitle: string
  billDate: string
  items: { itemName: string; itemId: string; shareAmount: number }[]
  totalAmount: number
}

export default function PaymentSummary() {
  const router = useRouter()
  const [summaries, setSummaries] = useState<ParticipantSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedParticipant, setSelectedParticipant] = useState<string | null>(null) // 存儲參與者名稱
  const [totalAmount, setTotalAmount] = useState(0)
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null)
  const [isBillModalOpen, setIsBillModalOpen] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false) // 控制摺疊/展開，預設為折疊
  const [isParticipantDetailModalOpen, setIsParticipantDetailModalOpen] = useState(false)
  const [user, setUser] = useState<any>(null) // 用戶狀態
  const [paidAmounts, setPaidAmounts] = useState<Record<string, string>>({})
  const [paidLoading, setPaidLoading] = useState(false)
  const [modalViewportOffset, setModalViewportOffset] = useState(64)
  const [isModalBackdropMouseDown, setIsModalBackdropMouseDown] = useState(false)

  const loadPaymentSummary = useCallback(async () => {
    let timeoutId: NodeJS.Timeout | null = null
    try {
      console.log('PaymentSummary: Setting loading to true')
      setLoading(true)
      setError(null)

      // 添加超時保護
      timeoutId = setTimeout(() => {
        console.error('Payment summary query timeout after 15 seconds')
        setError('查詢超時，請檢查網路連線或 Supabase 設定')
        setLoading(false)
      }, 15000) // 15秒超時

      console.log('PaymentSummary: Starting split_details query')
      // 查詢所有分擔明細
      const { data: splitDetails, error: splitError } = await supabase
        .from('split_details')
        .select('id, share_amount, participant_id, bill_item_id')
      
      console.log('PaymentSummary: Split details query completed', { 
        hasData: !!splitDetails, 
        dataLength: splitDetails?.length || 0,
        hasError: !!splitError 
      })

      if (timeoutId) clearTimeout(timeoutId)

      if (splitError) {
        console.error('Split details query error:', splitError)
        // 檢查是否是權限問題
        if (splitError.message?.includes('permission denied') || splitError.message?.includes('row-level security')) {
          throw new Error('權限不足：請確認已在 Supabase 中執行訪客模式更新腳本')
        }
        throw new Error(`查詢分擔明細失敗：${splitError.message || '未知錯誤'}`)
      }

      if (!splitDetails || splitDetails.length === 0) {
        setSummaries([])
        setTotalAmount(0)
        setLoading(false)
        return
      }

      // 獲取所有相關的 bill_item_id 和 participant_id
      // 過濾掉 null、undefined 和空字串，並驗證 UUID 格式
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      
      const itemIds = [...new Set(splitDetails.map((s) => s.bill_item_id))]
        .filter((id): id is string => {
          if (!id || typeof id !== 'string' || id.trim().length === 0) return false
          // 驗證 UUID 格式
          return uuidRegex.test(id.trim())
        })
      
      const participantIds = [...new Set(splitDetails.map((s) => s.participant_id))]
        .filter((id): id is string => {
          if (!id || typeof id !== 'string' || id.trim().length === 0) return false
          // 驗證 UUID 格式
          return uuidRegex.test(id.trim())
        })

      // 如果沒有有效的 ID，直接返回
      if (itemIds.length === 0 || participantIds.length === 0) {
        console.log('PaymentSummary: No valid IDs found', { itemIds: itemIds.length, participantIds: participantIds.length })
        setSummaries([])
        setTotalAmount(0)
        setLoading(false)
        return
      }

      console.log('PaymentSummary: Querying with valid IDs', { 
        itemIdsCount: itemIds.length, 
        participantIdsCount: participantIds.length,
        itemIdsSample: itemIds.slice(0, 5)
      })

      // 輔助函數：分批查詢以避免陣列過大
      const batchQuery = async <T>(
        table: string,
        selectFields: string,
        idField: string,
        ids: string[],
        batchSize: number = 100
      ): Promise<T[]> => {
        const results: T[] = []
        for (let i = 0; i < ids.length; i += batchSize) {
          const batch = ids.slice(i, i + batchSize)
          const { data, error } = await supabase
            .from(table)
            .select(selectFields)
            .in(idField, batch)
          
          if (error) {
            // 嘗試直接訪問錯誤對象的所有可能屬性
            const errorInfo = {
              message: error.message,
              code: error.code,
              hint: error.hint,
              details: error.details,
              toString: error.toString(),
              // 嘗試序列化（可能會失敗）
              raw: error
            }
            console.error(`${table} query error (batch ${i / batchSize + 1}):`, errorInfo)
            throw new Error(`查詢${table}失敗：${error.message || error.code || error.hint || 'Bad Request'}`)
          }
          
          if (data) {
            results.push(...data as T[])
          }
        }
        return results
      }

      // 並行查詢品項和參與者（使用分批查詢）
      let items: any[] = []
      let participants: any[] = []
      
      try {
        const [itemsResult, participantsResult] = await Promise.all([
          itemIds.length > 0
            ? batchQuery('bill_items', 'id, item_name, bill_id', 'id', itemIds)
                .then(data => ({ data, error: null }))
                .catch(error => ({ data: null, error }))
            : Promise.resolve({ data: [], error: null }),
          participantIds.length > 0
            ? batchQuery('bill_participants', 'id, name', 'id', participantIds)
                .then(data => ({ data, error: null }))
                .catch(error => ({ data: null, error }))
            : Promise.resolve({ data: [], error: null }),
        ])

        if (itemsResult.error) {
          throw itemsResult.error
        }
        if (participantsResult.error) {
          throw participantsResult.error
        }

        items = itemsResult.data || []
        participants = participantsResult.data || []
      } catch (error: any) {
        console.error('Query error caught:', error)
        // 檢查是否是權限問題
        const errorMessage = error?.message || String(error) || '未知錯誤'
        if (errorMessage.includes('permission denied') || errorMessage.includes('row-level security')) {
          throw new Error('權限不足：請確認已在 Supabase 中執行訪客模式更新腳本')
        }
        throw new Error(`查詢失敗：${errorMessage}`)
      }

      // 查詢 bills（使用分批查詢）
      const billIds = [...new Set(items.map((i: any) => i.bill_id))]
      
      let bills: any[] = []
      if (billIds.length > 0) {
        try {
          bills = await batchQuery('bills', 'id, title, bill_date', 'id', billIds)
        } catch (error: any) {
          console.error('Bills query error:', error)
          throw new Error(`查詢發票失敗：${error?.message || '未知錯誤'}`)
        }
      }
      const billsMap = new Map((bills || []).map((b: any) => [b.id, b]))
      const itemsMap = new Map(items.map((i: any) => [i.id, i]))
      const participantsMap = new Map(participants.map((p: any) => [p.id, p]))

      // 按參與者名稱分組並計算總額（不是按 participant_id，因為同一個人在不同發票中會有不同的 participant_id）
      const participantMap = new Map<string, ParticipantSummary>()

      splitDetails.forEach((split) => {
        const participantId = split.participant_id
        const participant = participantsMap.get(participantId)
        if (!participant) return

        const item = itemsMap.get(split.bill_item_id)
        if (!item) return

        const bill = billsMap.get(item.bill_id)
        if (!bill) return

        const shareAmount = parseFloat(split.share_amount.toString())
        const participantName = participant.name

        // 按名稱分組，而不是按 participant_id
        if (!participantMap.has(participantName)) {
          participantMap.set(participantName, {
            participantName,
            totalAmount: 0,
            details: [],
          })
        }

        const summary = participantMap.get(participantName)!
        summary.totalAmount += shareAmount
        summary.details.push({
          billId: bill.id,
          billTitle: bill.title,
          billDate: bill.bill_date,
          itemName: item.item_name,
          itemId: item.id,
          shareAmount,
        })
      })

      // 轉換為陣列並排序（按參與者名稱開頭的第一個數字從小到大）
      const summariesArray = Array.from(participantMap.values()).sort((a, b) => {
        // 提取開頭的第一個數字（例如 "8 - 好‧食‧城..." 中的 8）
        const getFirstNumber = (str: string): number => {
          // 優先匹配開頭的數字（格式：數字 - 標題）
          const startMatch = str.match(/^(\d+)\s*-/)
          if (startMatch) {
            const num = parseInt(startMatch[1], 10)
            return isNaN(num) ? Infinity : num
          }
          // 如果開頭沒有數字，嘗試匹配字串中的第一個數字
          const anyMatch = str.match(/\d+/)
          if (anyMatch) {
            const num = parseInt(anyMatch[0], 10)
            return isNaN(num) ? Infinity : num
          }
          return Infinity
        }
        
        const numA = getFirstNumber(a.participantName)
        const numB = getFirstNumber(b.participantName)
        
        // 如果都有數字，按數字排序
        if (numA !== Infinity && numB !== Infinity) {
          const diff = numA - numB
          // 如果數字相同，按名稱排序
          return diff !== 0 ? diff : a.participantName.localeCompare(b.participantName, 'zh-TW')
        }
        // 如果只有一個有數字，有數字的排在前面
        if (numA !== Infinity) return -1
        if (numB !== Infinity) return 1
        // 如果都沒有數字，按名稱排序
        return a.participantName.localeCompare(b.participantName, 'zh-TW')
      })

      setSummaries(summariesArray)
      setTotalAmount(summariesArray.reduce((sum, s) => sum + s.totalAmount, 0))
      setError(null)
    } catch (error: any) {
      if (timeoutId) clearTimeout(timeoutId)
      console.error('Error loading payment summary:', error)
      const errorMessage = error?.message || '載入應繳金額時發生錯誤'
      setError(errorMessage)
      setSummaries([])
      setTotalAmount(0)
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    console.log('PaymentSummary: Starting loadPaymentSummary')
    loadPaymentSummary()
    
    // 載入用戶狀態
    const loadUser = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      setUser(session?.user || null)
    }
    loadUser()
    
    // 監聽 auth 狀態變化
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    
    return () => {
      subscription.unsubscribe()
    }
  }, [loadPaymentSummary])

  const loadPaidAmounts = useCallback(async () => {
    try {
      setPaidLoading(true)
      const { data, error } = await supabase
        .from('participant_payments')
        .select('participant_name, paid_amount')
      if (error) throw error
      const map: Record<string, string> = {}
      data?.forEach((row) => {
        map[row.participant_name] =
          row.paid_amount !== null && row.paid_amount !== undefined ? row.paid_amount.toString() : ''
      })
      setPaidAmounts(map)
    } catch (err) {
      console.error('載入已繳金額失敗：', err)
    } finally {
      setPaidLoading(false)
    }
  }, [])

  const persistPaidAmount = useCallback(async (name: string, amount: number) => {
    if (!user) return // 訪客模式不允許儲存
    if (!name || isNaN(amount)) return
    try {
      const { error } = await supabase
        .from('participant_payments')
        .upsert(
          {
            participant_name: name,
            paid_amount: amount,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: 'participant_name',
          }
        )
      if (error) throw error
    } catch (err) {
      console.error('儲存已繳金額失敗：', err)
    }
  }, [user])

  useEffect(() => {
    loadPaidAmounts()
  }, [loadPaidAmounts])

  useEffect(() => {
    setPaidAmounts((prev) => {
      const updated = { ...prev }
      let changed = false
      summaries.forEach((summary) => {
        if (updated[summary.participantName] === undefined) {
          updated[summary.participantName] = ''
          changed = true
        }
      })
      return changed ? updated : prev
    })
  }, [summaries])

  const handlePaidChange = (name: string, value: string) => {
    if (!user) return // 訪客模式不允許編輯
    if (!/^\d*(\.\d{0,2})?$/.test(value)) return
    setPaidAmounts((prev) => ({ ...prev, [name]: value }))
  }

  const handlePaidBlur = (name: string) => {
    if (!user) return // 訪客模式不允許編輯
    const parsed = parseFloat(paidAmounts[name] || '0')
    if (isNaN(parsed)) return
    persistPaidAmount(name, parsed)
  }

  const handleFillTotal = (name: string, amount: number) => {
    if (!user) return // 訪客模式不允許編輯
    setPaidAmounts((prev) => ({ ...prev, [name]: amount.toFixed(2) }))
    persistPaidAmount(name, amount)
  }

  const handleParticipantSelect = (
    e: React.MouseEvent<HTMLDivElement>,
    name: string
  ) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const modalHeight = Math.min(viewportHeight - 64, 520)
    let offset = rect.top - modalHeight / 2 + window.scrollY
    offset = Math.max(window.scrollY + 24, offset)
    offset = Math.min(window.scrollY + viewportHeight - modalHeight - 24, offset)
    setModalViewportOffset(offset)
    setSelectedParticipant(name)
    setIsParticipantDetailModalOpen(true)
  }

  // 處理 ESC 鍵關閉參與者明細 Modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isParticipantDetailModalOpen) {
        setIsParticipantDetailModalOpen(false)
        setSelectedParticipant(null)
      }
    }

    if (isParticipantDetailModalOpen) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = 'unset'
    }
  }, [isParticipantDetailModalOpen])

  const maxAmount = summaries.length > 0 ? Math.max(...summaries.map((s) => s.totalAmount)) : 0

  if (loading) {
    return (
      <div className="motion-shell p-4 sm:p-6">
        <div className="text-center text-slate-600 text-sm sm:text-base font-medium">載入中...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="motion-shell p-4 sm:p-6">
        <h2 className="text-lg sm:text-xl font-bold text-slate-900 mb-4 pb-4 border-b border-gray-200">應繳金額總覽</h2>
        <div className="bg-error-50 border border-error-200 rounded-lg p-4">
          <p className="text-error-800 font-semibold mb-2">載入失敗</p>
          <p className="text-error-700 text-sm mb-4">{error}</p>
          <button
            onClick={loadPaymentSummary}
            className="cursor-pointer px-4 py-2 bg-error-600 text-white rounded-lg hover:bg-error-700 transition-colors text-sm font-medium"
          >
            重新載入
          </button>
        </div>
      </div>
    )
  }

  if (summaries.length === 0) {
    return (
      <div className="motion-shell p-4 sm:p-6">
        <h2 className="text-lg sm:text-xl font-bold text-slate-900 mb-4 pb-4 border-b border-gray-200">應繳金額總覽</h2>
        <div className="text-center text-slate-600 py-6 sm:py-8 text-sm sm:text-base font-medium">尚無分帳資料</div>
      </div>
    )
  }

  const selectedSummary = selectedParticipant
    ? summaries.find((s) => s.participantName === selectedParticipant)
    : null

  return (
    <div className="motion-shell p-4 sm:p-6 mb-6 sm:mb-8">
      {/* 標題和摺疊按鈕 */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex justify-between items-center mb-4 sm:mb-5 pb-4 border-b border-gray-200 text-left cursor-pointer group"
      >
        <h2 className="text-lg sm:text-xl font-bold text-slate-900">應繳金額總覽</h2>
        <span className="flex items-center gap-2 text-xs sm:text-sm font-medium text-slate-600 group-hover:text-slate-900 transition-colors">
          {isExpanded ? '收起' : '展開'}
          <svg
            className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 9l7 7 7-7" />
          </svg>
        </span>
      </button>

      {paidLoading && (
        <div className="mb-4 text-xs font-medium text-slate-500 flex items-center gap-2">
          <svg className="w-3.5 h-3.5 animate-spin text-primary-500" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8z"
            />
          </svg>
          正在同步已繳金額…
        </div>
      )}

      {isExpanded && (
        <>
          {/* 圖表區域 */}
          <div className="mb-5 sm:mb-6">
            <h3 className="text-base sm:text-lg font-semibold text-slate-900 mb-4 sm:mb-5">每人應繳金額</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
              {summaries.map((summary) => {
                const owedWidth = Math.min(
                  maxAmount > 0 ? (summary.totalAmount / maxAmount) * 100 : 0,
                  100
                )
                const paidAmount = parseFloat(paidAmounts[summary.participantName] || '0') || 0
                const remaining = Math.max(summary.totalAmount - paidAmount, 0)
                const paidRatio =
                  summary.totalAmount > 0 ? Math.min(paidAmount / summary.totalAmount, 1) : 0
                // 當剩餘金額小於 0.01 或已繳比例 >= 1 時，視為 100%，綠色條填滿整個進度條
                const isFullyPaid = remaining <= 0.01 || paidRatio >= 1
                const paidWidth = isFullyPaid ? 100 : owedWidth * paidRatio
                const isSelected = selectedParticipant === summary.participantName

                return (
                  <div
                    key={summary.participantName}
                    className={`motion-card cursor-pointer rounded-xl border transition-all duration-200 shadow-sm hover:shadow-md relative overflow-hidden ${
                      isSelected
                        ? 'ring-2 ring-primary-500 border-primary-300'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                    onClick={(e) => handleParticipantSelect(e, summary.participantName)}
                  >
                    {/* 進度條背景 */}
                    <div
                      className="absolute inset-0 bg-gradient-to-r from-success-500 to-success-400 transition-all duration-300"
                      style={{ width: `${isFullyPaid ? 100 : paidRatio * 100}%` }}
                    />
                    {/* 未繳部分背景 */}
                    <div
                      className="absolute inset-0 bg-white transition-all duration-300"
                      style={{ left: `${isFullyPaid ? 100 : paidRatio * 100}%` }}
                    />
                    {/* 內容區域 */}
                    <div className="relative z-10 p-4 sm:p-5">
                      {/* 標題區域 */}
                      <div className="flex items-center justify-between mb-4 gap-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center ${
                            paidRatio >= 0.5 ? 'bg-white/20 backdrop-blur-sm' : 'bg-primary-100'
                          }`}>
                            <span className={`text-lg sm:text-xl font-bold ${
                              paidRatio >= 0.5 ? 'text-white' : 'text-primary-600'
                            }`}>
                              {summary.participantName.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <div className={`font-bold text-sm sm:text-base ${
                              paidRatio >= 0.5 ? 'text-white drop-shadow-sm' : 'text-slate-900'
                            }`}>
                              {summary.participantName}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`text-lg sm:text-xl font-bold whitespace-nowrap currency ${
                            paidRatio >= 0.5 ? 'text-white drop-shadow-md' : 'text-primary-600'
                          }`}>
                            ${summary.totalAmount.toFixed(2)}
                          </div>
                        </div>
                      </div>

                      {/* 已繳金額區域 */}
                      <div
                        className="rounded-lg border border-gray-200/50 bg-white/80 backdrop-blur-sm p-3 sm:p-4 space-y-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs sm:text-sm font-semibold text-slate-700">已繳金額</span>
                          {user && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleFillTotal(summary.participantName, summary.totalAmount)
                              }}
                              className="cursor-pointer text-primary-600 hover:text-primary-700 transition-colors text-xs sm:text-sm font-medium px-2 py-1 rounded hover:bg-primary-50"
                            >
                              一鍵填滿
                            </button>
                          )}
                          {!user && (
                            <span className="text-xs text-slate-500 italic">僅供查看</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="relative flex-1">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500 font-medium">$</span>
                            <input
                              type="text"
                              inputMode="decimal"
                              value={paidAmounts[summary.participantName] ?? ''}
                              onChange={(e) => handlePaidChange(summary.participantName, e.target.value)}
                              disabled={!user}
                              className={`w-full rounded-lg border py-2.5 pl-7 pr-3 text-sm tabular-nums transition-colors ${
                                user
                                  ? 'border-gray-300 bg-white text-slate-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100'
                                  : 'border-gray-200 bg-gray-50 text-slate-500 cursor-not-allowed'
                              }`}
                              placeholder="0.00"
                              onBlur={() => handlePaidBlur(summary.participantName)}
                            />
                          </div>
                          <div className="text-right min-w-[80px]">
                            <div className="text-xs font-semibold text-slate-600 mb-1">剩餘</div>
                            <div className="currency text-base font-bold text-slate-900">
                              ${remaining.toFixed(2)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      {/* 參與者明細模態框 */}
      {isParticipantDetailModalOpen && selectedSummary && (() => {
        // 按發票分組
        const groupedDetails = new Map<string, GroupedDetail>()
        
        selectedSummary.details.forEach((detail) => {
          if (!groupedDetails.has(detail.billId)) {
            groupedDetails.set(detail.billId, {
              billId: detail.billId,
              billTitle: detail.billTitle,
              billDate: detail.billDate,
              items: [],
              totalAmount: 0,
            })
          }
          const group = groupedDetails.get(detail.billId)!
          group.items.push({
            itemName: detail.itemName,
            itemId: detail.itemId,
            shareAmount: detail.shareAmount,
          })
          group.totalAmount += detail.shareAmount
        })

        // 轉換為陣列並排序（按日期降序）
        const groupedArray = Array.from(groupedDetails.values()).sort(
          (a, b) => new Date(b.billDate).getTime() - new Date(a.billDate).getTime()
        )

        return (
          <div
            className="fixed inset-0 z-50 flex justify-center p-4 bg-black bg-opacity-50 overflow-y-auto"
            style={{ alignItems: 'flex-start', paddingTop: modalViewportOffset }}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setIsModalBackdropMouseDown(true)
            }}
            onMouseUp={(e) => {
              if (isModalBackdropMouseDown && e.target === e.currentTarget) {
                setIsParticipantDetailModalOpen(false)
                setSelectedParticipant(null)
              }
              setIsModalBackdropMouseDown(false)
            }}
          >
            <div
              className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex justify-between items-center p-4 sm:p-6 border-b border-gray-200 bg-white">
                <h3 className="text-lg sm:text-xl font-bold text-slate-900">
                  {selectedSummary.participantName} 的明細
                </h3>
                <button
                  onClick={() => {
                    setIsParticipantDetailModalOpen(false)
                    setSelectedParticipant(null)
                  }}
                  className="cursor-pointer text-slate-400 hover:text-slate-600 transition-colors p-1 rounded hover:bg-gray-100"
                  aria-label="關閉"
                >
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Modal Content */}
              <div className="overflow-y-auto flex-1 p-6">
                {/* 以發票為單位顯示 */}
                <div className="space-y-4">
                  {groupedArray.map((group) => (
                    <div
                      key={group.billId}
                      className="border border-gray-200 rounded-lg overflow-hidden cursor-pointer hover:border-primary-400 hover:shadow-md transition-all bg-white"
                      onClick={() => {
                        setSelectedBillId(group.billId)
                        setIsBillModalOpen(true)
                        // 不關閉參與者明細 Modal，讓兩個 Modal 同時存在
                      }}
                    >
                      {/* 發票標題 */}
                      <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                        <div className="flex justify-between items-center">
                          <div>
                            <h4 className="font-semibold text-slate-900">{group.billTitle}</h4>
                            <p className="text-sm text-slate-600 mt-1 font-medium">
                              {format(new Date(group.billDate), 'yyyy年MM月dd日', { locale: zhTW })}
                            </p>
                          </div>
                          <div className="text-right">
                            <span className="text-sm text-slate-600 font-medium">發票小計</span>
                            <div className="text-lg font-bold text-primary-600 currency">
                              ${group.totalAmount.toFixed(2)}
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      {/* 品項列表 */}
                      <div className="bg-white">
                        <table className="min-w-full border-collapse">
                          <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">
                                品項
                              </th>
                              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider w-24">
                                金額
                              </th>
                              {user && (
                                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-600 uppercase tracking-wider w-16">
                                  操作
                                </th>
                              )}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200 text-slate-700">
                            {group.items.map((item, index) => (
                              <tr key={index} className="hover:bg-gray-50 transition-colors">
                                <td className="px-4 py-3.5 text-sm text-slate-900">
                                  <span className="break-words font-medium">{item.itemName}</span>
                                </td>
                                <td className="px-4 py-3.5 text-sm font-semibold text-primary-600 text-right currency">
                                  ${item.shareAmount.toFixed(2)}
                                </td>
                                {user && (
                                  <td className="px-4 py-3.5 text-center">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        e.preventDefault()
                                        // 打開發票明細 Modal
                                        setSelectedBillId(group.billId)
                                        setIsBillModalOpen(true)
                                        // 延遲設置 hash 並執行滾動，確保 Modal 和 BillEditor 都已載入
                                        setTimeout(() => {
                                          const hash = `item-${item.itemId}`
                                          // 設置 URL hash
                                          if (typeof window !== 'undefined') {
                                            window.location.hash = hash
                                          }
                                          // 直接執行滾動作為主要方案
                                          setTimeout(() => {
                                            const element = document.getElementById(hash)
                                            if (element) {
                                              element.scrollIntoView({ behavior: 'smooth', block: 'start' })
                                              element.classList.add('ring-4', 'ring-primary-400', 'ring-opacity-50')
                                              setTimeout(() => {
                                                element.classList.remove('ring-4', 'ring-primary-400', 'ring-opacity-50')
                                              }, 2000)
                                            }
                                          }, 800) // 等待 BillEditor 載入完成
                                        }, 300)
                                      }}
                                      className="cursor-pointer text-xs text-primary-600 hover:text-primary-700 hover:underline whitespace-nowrap font-medium transition-colors"
                                    >
                                      編輯
                                    </button>
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                  
                  {/* 總計 */}
                  <div className="bg-primary-50 border-2 border-primary-200 rounded-lg p-4 sm:p-5">
                    <div className="flex justify-between items-center">
                      <span className="text-lg font-bold text-slate-900">總計</span>
                      <span className="text-2xl font-bold text-primary-600 currency">
                        ${selectedSummary.totalAmount.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
      
      {/* 發票明細模態框 */}
      <BillDetailModal
        isOpen={isBillModalOpen}
        onClose={() => {
          setIsBillModalOpen(false)
          setSelectedBillId(null)
        }}
        billId={selectedBillId}
      />
    </div>
  )
}

