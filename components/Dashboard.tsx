'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { format } from 'date-fns'
import { zhTW } from 'date-fns/locale'
import BillDetailModal from './BillDetailModal'
import PaymentSummary from './PaymentSummary'

interface Bill {
  id: string
  title: string
  bill_date: string
  total_amount: number
  checked: boolean
  payer: string
  created_at: string
  image_url?: string | null
}

interface MonthGroup {
  year: number
  month: number
  bills: Bill[]
  totalAmount: number
}

type ViewMode = 'month' | 'quarter'

export default function Dashboard() {
  const router = useRouter()
  const [bills, setBills] = useState<Bill[]>([])
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  // viewMode 狀態 (預設 'month'，客戶端掛載後從 localStorage 讀取)
  const [viewMode, setViewMode] = useState<ViewMode>('month')
  const [isViewModeLoaded, setIsViewModeLoaded] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [showBackToTop, setShowBackToTop] = useState(false)

  // 拖拉滾動相關
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [startX, setStartX] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [hasDragged, setHasDragged] = useState(false) // 用於區分拖拉和點擊

  // 拖拉滾動事件處理
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!scrollContainerRef.current) return
    setIsDragging(true)
    setHasDragged(false)
    setStartX(e.pageX - scrollContainerRef.current.offsetLeft)
    setScrollLeft(scrollContainerRef.current.scrollLeft)
    scrollContainerRef.current.style.cursor = 'grabbing'
    // 拖拉時暫時移除 snap 效果
    scrollContainerRef.current.style.scrollSnapType = 'none'
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !scrollContainerRef.current) return
    e.preventDefault()
    const x = e.pageX - scrollContainerRef.current.offsetLeft
    const walk = (x - startX) * 1.5 // 滾動速度倍率
    // 只有移動超過 5px 才算拖拉
    if (Math.abs(x - startX) > 5) {
      setHasDragged(true)
    }
    scrollContainerRef.current.scrollLeft = scrollLeft - walk
  }, [isDragging, startX, scrollLeft])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
    if (scrollContainerRef.current) {
      scrollContainerRef.current.style.cursor = 'grab'
      // 恢復 snap 效果
      scrollContainerRef.current.style.scrollSnapType = 'x mandatory'
    }
  }, [])

  const handleMouseLeave = useCallback(() => {
    if (isDragging) {
      setIsDragging(false)
      if (scrollContainerRef.current) {
        scrollContainerRef.current.style.cursor = 'grab'
        // 恢復 snap 效果
        scrollContainerRef.current.style.scrollSnapType = 'x mandatory'
      }
    }
  }, [isDragging])

  // 點擊卡片時檢查是否為拖拉
  const handleCardClick = useCallback((billId: string) => {
    if (hasDragged) return // 如果是拖拉，不觸發點擊
    setSelectedBillId(billId)
    setIsModalOpen(true)
    setPendingDeleteId(null) // 點擊卡片時取消待刪除狀態
  }, [hasDragged])

  useEffect(() => {
    // 優化載入：使用 getSession 更快（從本地快取）
    const loadData = async () => {
      try {
        setError(null)
        setLoading(true)

        // 使用 getSession 比 getUser 更快（從本地快取）
        const sessionResult = await supabase.auth.getSession()
        const user = sessionResult.data?.session?.user || null
        setUser(user)

        // 構建查詢（只選擇需要的欄位）
        let query = supabase
          .from('bills')
          .select('id, title, bill_date, total_amount, checked, created_by, created_at, payer')
          .order('bill_date', { ascending: false })

        if (user) {
          // 登入用戶：只顯示自己建立的發票
          query = query.eq('created_by', user.id)
        }
        // 訪客模式：不添加過濾條件，載入所有發票

        const { data, error: queryError } = await query

        if (queryError) {
          throw queryError
        }

        setBills(data || [])
      } catch (error: any) {
        console.error('Error loading data:', error)
        // 檢查是否是 RLS 權限問題
        if (error?.message?.includes('permission denied') || error?.message?.includes('row-level security')) {
          setError('無法載入發票：請確認已在 Supabase 中執行訪客模式更新腳本（supabase_guest_mode_update.sql）')
        } else {
          setError(`載入發票時發生錯誤：${error?.message || '未知錯誤'}`)
        }
      } finally {
        setLoading(false)
      }
    }

    loadData()

    // 監聽 auth 狀態變化
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      // 重新載入發票
      loadBills()
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  // 當 viewMode 變更時儲存到 localStorage（只在初次載入完成後才儲存）
  useEffect(() => {
    if (isViewModeLoaded) {
      localStorage.setItem('dashboard_viewMode', viewMode)
    }
  }, [viewMode, isViewModeLoaded])

  // 客戶端掛載後從 localStorage 讀取 viewMode
  useEffect(() => {
    const saved = localStorage.getItem('dashboard_viewMode')
    if (saved === 'month' || saved === 'quarter') {
      setViewMode(saved)
    }
    setIsViewModeLoaded(true)
  }, [])

  // 儲存捲動位置到 localStorage（依據 viewMode 分開存儲）
  const saveScrollPosition = useCallback(() => {
    if (scrollContainerRef.current) {
      localStorage.setItem(`dashboard_scrollLeft_${viewMode}`, String(scrollContainerRef.current.scrollLeft))
    }
  }, [viewMode])

  // 恢復捲動位置
  useEffect(() => {
    // 當資料載入完成且 viewMode 已從 localStorage 載入後恢復捲動位置
    if (!loading && bills.length > 0 && isViewModeLoaded && scrollContainerRef.current) {
      const savedScrollLeft = localStorage.getItem(`dashboard_scrollLeft_${viewMode}`)
      if (savedScrollLeft) {
        // 使用 requestAnimationFrame 確保 DOM 已渲染
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollLeft = parseInt(savedScrollLeft, 10)
          }
        })
      }
    }
  }, [loading, bills.length, viewMode, isViewModeLoaded])

  // 監聽橫向滾動以儲存位置
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const handleHorizontalScroll = () => {
      saveScrollPosition()
    }

    container.addEventListener('scroll', handleHorizontalScroll)
    return () => container.removeEventListener('scroll', handleHorizontalScroll)
  }, [saveScrollPosition])

  // 監聯滾動，顯示/隱藏回到頂端按鈕
  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 300)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // 回到頂端
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const loadBills = async () => {
    try {
      setError(null)
      // 使用 getSession 更快
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const user = session?.user || null

      // 只選擇需要的欄位以減少資料傳輸
      let query = supabase
        .from('bills')
        .select('id, title, bill_date, total_amount, checked, created_by, created_at, image_url, payer')
        .order('bill_date', { ascending: false })

      if (user) {
        // 登入用戶：只顯示自己建立的發票
        query = query.eq('created_by', user.id)
      }
      // 訪客模式：不添加過濾條件，載入所有發票

      const { data, error: queryError } = await query

      if (queryError) {
        console.error('Error loading bills:', queryError)
        // 檢查是否是 RLS 政策問題
        if (queryError.message.includes('permission denied') || queryError.message.includes('row-level security')) {
          setError('無法載入發票：請確認已在 Supabase 中執行訪客模式更新腳本（supabase_guest_mode_update.sql）')
        } else {
          setError(`載入發票時發生錯誤：${queryError.message}`)
        }
        throw queryError
      }
      setBills(data || [])
    } catch (error: any) {
      console.error('Error loading bills:', error)
      if (!error.message?.includes('permission denied') && !error.message?.includes('row-level security')) {
        // 如果不是 RLS 錯誤，顯示一般錯誤訊息
        if (!error.message?.includes('Error loading bills')) {
          setError(`載入發票時發生錯誤：${error.message || '未知錯誤'}`)
        }
      }
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    // 登出後回到首頁（訪客模式）
    router.push('/')
    router.refresh()
  }

  const handleDeleteBill = async (billId: string) => {
    // 如果還沒有確認，設置為待刪除狀態
    if (pendingDeleteId !== billId) {
      setPendingDeleteId(billId)
      return
    }

    // 已經確認，執行刪除
    try {
      const { error } = await supabase.from('bills').delete().eq('id', billId)
      if (error) throw error
      setPendingDeleteId(null)
      loadBills()
    } catch (error) {
      console.error('Error deleting bill:', error)
      alert('刪除失敗')
      setPendingDeleteId(null)
    }
  }

  const handleToggleChecked = async (billId: string, currentChecked: boolean) => {
    try {
      const { error } = await supabase
        .from('bills')
        .update({ checked: !currentChecked })
        .eq('id', billId)

      if (error) throw error

      // 更新本地狀態
      setBills(bills.map((bill) =>
        bill.id === billId ? { ...bill, checked: !currentChecked } : bill
      ))
    } catch (error) {
      console.error('Error toggling checked status:', error)
      alert('更新檢核狀態失敗')
    }
  }

  // 處理發票儲存後的局部更新（避免整頁刷新）
  const handleBillSave = useCallback((updatedBill: {
    id: string
    title: string
    total_amount: number
    checked: boolean
    payer: string
  }) => {
    setBills(prevBills =>
      prevBills.map(bill =>
        bill.id === updatedBill.id
          ? { ...bill, ...updatedBill }
          : bill
      )
    )
  }, [])

  // 按月份分組發票
  const monthGroups = useMemo(() => {
    const groups = new Map<string, { year: number; month: number; bills: Bill[] }>()

    bills.forEach((bill) => {
      const date = new Date(bill.bill_date)
      const year = date.getFullYear()
      const month = date.getMonth() + 1
      const key = `${year}-${month}`

      if (!groups.has(key)) {
        groups.set(key, { year, month, bills: [] })
      }
      groups.get(key)!.bills.push(bill)
    })

    // 轉換為陣列並排序：先按年份（新到舊），再按月份（1~12）
    return Array.from(groups.values())
      .map((group) => {
        // 對每個月份組內的發票按標題的第一個數字排序（從小到大）
        const sortedBills = [...group.bills].sort((a, b) => {
          // 提取標題中的數字（跳過前導空格）
          const matchA = a.title.match(/^\s*(\d+)/)
          const matchB = b.title.match(/^\s*(\d+)/)
          const numA = matchA ? parseInt(matchA[1], 10) : 999999
          const numB = matchB ? parseInt(matchB[1], 10) : 999999

          // 按數字從小到大排序
          if (numA !== numB) return numA - numB
          // 如果數字相同，按標題字母順序排序
          return a.title.localeCompare(b.title, 'zh-TW')
        })

        return {
          ...group,
          bills: sortedBills,
          totalAmount: sortedBills.reduce((sum, bill) => sum + bill.total_amount, 0),
        }
      })
      .sort((a, b) => {
        if (a.year !== b.year) return a.year - b.year // 年份：舊到新（最小在最左）
        return a.month - b.month // 月份：1~12（左到右）
      })
  }, [bills])

  // 按季度分組發票
  const quarterGroups = useMemo(() => {
    const groups = new Map<string, { year: number; quarter: number; bills: Bill[] }>()

    bills.forEach((bill) => {
      const date = new Date(bill.bill_date)
      const year = date.getFullYear()
      const month = date.getMonth() + 1
      const quarter = Math.ceil(month / 3)
      const key = `${year}-Q${quarter}`

      if (!groups.has(key)) {
        groups.set(key, { year, quarter, bills: [] })
      }
      groups.get(key)!.bills.push(bill)
    })

    // 轉換為陣列並排序：先按年份（新到舊），再按季度（1~4，左到右）
    return Array.from(groups.values())
      .map((group) => {
        // 對每個季度組內的發票按標題的第一個數字排序（從小到大）
        const sortedBills = [...group.bills].sort((a, b) => {
          // 提取標題中的數字（跳過前導空格）
          const matchA = a.title.match(/^\s*(\d+)/)
          const matchB = b.title.match(/^\s*(\d+)/)
          const numA = matchA ? parseInt(matchA[1], 10) : 999999
          const numB = matchB ? parseInt(matchB[1], 10) : 999999

          // 按數字從小到大排序
          if (numA !== numB) return numA - numB
          // 如果數字相同，按標題字母順序排序
          return a.title.localeCompare(b.title, 'zh-TW')
        })

        return {
          ...group,
          bills: sortedBills,
          totalAmount: sortedBills.reduce((sum, bill) => sum + bill.total_amount, 0),
        }
      })
      .sort((a, b) => {
        if (a.year !== b.year) return a.year - b.year // 年份：舊到新（最小在最左）
        return a.quarter - b.quarter // 季度：1~4（左到右）
      })
  }, [bills])

  // 獲取月份名稱
  const getMonthName = (month: number) => {
    const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']
    return monthNames[month - 1]
  }

  // 獲取季度名稱
  const getQuarterName = (quarter: number) => {
    const quarterNames = ['第一季', '第二季', '第三季', '第四季']
    return quarterNames[quarter - 1]
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">載入中...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-5">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">還錢好過年</h1>
            <div className="flex flex-wrap items-center gap-2 sm:gap-4 w-full sm:w-auto">
              <span className="text-xs sm:text-sm text-slate-600 truncate font-medium">
                {user
                  ? user?.user_metadata?.full_name ||
                  (user?.email ? user.email.split('@')[0] : '使用者')
                  : '訪客模式'}
              </span>
              {user ? (
                <button
                  onClick={handleLogout}
                  className="cursor-pointer px-3 sm:px-4 py-2 text-xs sm:text-sm bg-gray-100 text-slate-700 rounded-lg hover:bg-gray-200 transition-colors whitespace-nowrap font-medium border border-gray-200"
                >
                  登出
                </button>
              ) : (
                <button
                  onClick={() => router.push('/auth')}
                  className="cursor-pointer px-3 sm:px-4 py-2 text-xs sm:text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors whitespace-nowrap font-medium"
                >
                  登入
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* 應繳金額總覽 Dashboard */}
        <div className="mb-6 sm:mb-8">
          <PaymentSummary />
        </div>

        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 sm:gap-6 mb-6 sm:mb-8 pb-4 border-b border-gray-200">
          <h2 className="text-lg sm:text-xl font-semibold text-slate-900">
            發票紀錄{!user && <span className="block sm:inline sm:ml-2 mt-1 sm:mt-0 text-xs sm:text-sm text-slate-600 font-normal">(訪客模式 - 查看所有發票)</span>}
          </h2>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 w-full sm:w-auto">
            {/* 視圖模式切換 */}
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1 border border-gray-200">
              <button
                onClick={() => setViewMode('month')}
                className={`cursor-pointer px-3 sm:px-4 py-2 rounded-md text-xs sm:text-sm font-medium transition-colors ${viewMode === 'month'
                  ? 'bg-white text-primary-600 shadow-sm border border-primary-200'
                  : 'text-slate-600 hover:text-slate-900'
                  }`}
              >
                月份
              </button>
              <button
                onClick={() => setViewMode('quarter')}
                className={`cursor-pointer px-3 sm:px-4 py-2 rounded-md text-xs sm:text-sm font-medium transition-colors ${viewMode === 'quarter'
                  ? 'bg-white text-primary-600 shadow-sm border border-primary-200'
                  : 'text-slate-600 hover:text-slate-900'
                  }`}
              >
                季度
              </button>
            </div>
            {user && (
              <button
                onClick={() => router.push('/bills/new')}
                className="cursor-pointer px-4 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium text-sm sm:text-base whitespace-nowrap"
              >
                + 新增發票
              </button>
            )}
          </div>
        </div>

        {error ? (
          <div className="bg-error-50 border border-error-200 rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-semibold text-error-800 mb-2">載入錯誤</h3>
            <p className="text-error-700 mb-4 font-medium">{error}</p>
            <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
              <p className="text-sm font-semibold text-slate-900 mb-2">解決步驟：</p>
              <ol className="list-decimal list-inside text-sm text-slate-700 space-y-1.5 font-medium">
                <li>登入 <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:text-primary-700 hover:underline cursor-pointer">Supabase Dashboard</a></li>
                <li>選擇您的專案</li>
                <li>進入 <strong className="text-slate-900">SQL Editor</strong></li>
                <li>執行 <code className="bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200 text-slate-900 font-mono text-xs">supabase_guest_mode_update.sql</code> 檔案中的 SQL 腳本</li>
                <li>重新整理此頁面</li>
              </ol>
            </div>
            <button
              onClick={loadBills}
              className="cursor-pointer px-4 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium"
            >
              重新載入
            </button>
          </div>
        ) : bills.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 sm:p-12 text-center">
            <p className="text-slate-600 mb-6 sm:mb-8 text-base sm:text-lg font-medium">尚無發票紀錄</p>
            {user && (
              <button
                onClick={() => router.push('/bills/new')}
                className="cursor-pointer px-6 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm sm:text-base font-medium"
              >
                建立第一個發票
              </button>
            )}
          </div>
        ) : (
          <div className="relative">
            {/* 可滑動的卡片容器 */}
            <div
              ref={scrollContainerRef}
              className="overflow-x-auto scrollbar-hide pb-4 sm:pb-6 snap-x snap-mandatory -mx-4 sm:mx-0 px-4 sm:px-0 cursor-grab select-none"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseLeave}
            >
              <div className="flex gap-4 sm:gap-6 min-w-max">
                {viewMode === 'month'
                  ? monthGroups.map((group) => (
                    <div
                      key={`${group.year}-${group.month}`}
                      className="motion-card flex-shrink-0 w-[280px] sm:w-80 snap-start p-4 sm:p-6"
                    >
                      {/* 月份標題 */}
                      <div className="mb-4 sm:mb-5 pb-4 border-b border-gray-200">
                        <h3 className="text-lg sm:text-xl font-bold text-slate-900">
                          {group.year}年 {getMonthName(group.month)}
                        </h3>
                        <p className="text-xs sm:text-sm text-slate-600 mt-1.5 sm:mt-2 font-medium">
                          {group.bills.length} 筆發票 · 總計 <span className="currency font-semibold text-primary-600">${group.totalAmount.toFixed(0)}</span>
                        </p>
                      </div>

                      {/* 發票列表 */}
                      <div className="space-y-3 sm:space-y-4 max-h-[60vh] overflow-y-auto">
                        {group.bills.map((bill) => (
                          <div
                            key={bill.id}
                            className={`motion-card p-3 sm:p-4 cursor-pointer ${bill.checked
                              ? 'bg-success-50 border-success-200'
                              : ''
                              }`}
                            onClick={() => handleCardClick(bill.id)}
                          >
                            <div className="flex justify-between items-start mb-2 sm:mb-3 gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <h4 className="font-semibold text-slate-900 text-xs sm:text-sm break-words">{bill.title}</h4>
                                  {bill.payer && (
                                    <span className="text-[10px] bg-gray-100 px-1.5 py-0.5 rounded text-gray-600 font-medium whitespace-nowrap">
                                      {bill.payer} 付
                                    </span>
                                  )}
                                  {bill.image_url && (
                                    <svg className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                  )}
                                </div>
                              </div>
                              <span className="text-base sm:text-lg font-bold text-primary-600 whitespace-nowrap currency">
                                ${bill.total_amount.toFixed(0)}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 mb-2 sm:mb-3 font-medium">
                              {format(new Date(bill.bill_date), 'MM月dd日', { locale: zhTW })}
                            </p>
                            <div className="flex gap-2 mt-2 sm:mt-3">
                              {user && (
                                <>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setPendingDeleteId(null) // 點擊檢核按鈕時取消待刪除狀態
                                      handleToggleChecked(bill.id, bill.checked)
                                    }}
                                    className={`cursor-pointer text-xs px-2.5 py-1 rounded transition-colors font-medium border ${bill.checked
                                      ? 'bg-success-200 text-success-800 hover:bg-success-300 border-success-300'
                                      : 'bg-gray-100 text-slate-700 hover:bg-gray-200 border-gray-200'
                                      }`}
                                  >
                                    {bill.checked ? '✓ 已檢核' : '○ 未檢核'}
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleDeleteBill(bill.id)
                                    }}
                                    className={`cursor-pointer text-xs px-2.5 py-1 rounded transition-colors font-medium border ${pendingDeleteId === bill.id
                                      ? 'bg-error-500 text-white hover:bg-error-600 border-error-600'
                                      : 'text-error-600 hover:text-error-700 hover:bg-error-50 border-error-200'
                                      }`}
                                  >
                                    {pendingDeleteId === bill.id ? '確認刪除' : '刪除'}
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                  : quarterGroups.map((group) => (
                    <div
                      key={`${group.year}-Q${group.quarter}`}
                      className="motion-card flex-shrink-0 w-[280px] sm:w-80 snap-start p-4 sm:p-6"
                    >
                      {/* 季度標題 */}
                      <div className="mb-4 sm:mb-5 pb-4 border-b border-gray-200">
                        <h3 className="text-lg sm:text-xl font-bold text-slate-900">
                          {group.year}年 {getQuarterName(group.quarter)}
                        </h3>
                        <p className="text-xs sm:text-sm text-slate-600 mt-1.5 sm:mt-2 font-medium">
                          {group.bills.length} 筆發票 · 總計 <span className="currency font-semibold text-primary-600">${group.totalAmount.toFixed(0)}</span>
                        </p>
                      </div>

                      {/* 發票列表 */}
                      <div className="space-y-3 max-h-[60vh] overflow-y-auto">
                        {group.bills.map((bill) => (
                          <div
                            key={bill.id}
                            className={`motion-card p-3 sm:p-4 cursor-pointer ${bill.checked ? 'bg-success-50 border-success-200' : ''
                              }`}
                            onClick={() => handleCardClick(bill.id)}
                          >
                            <div className="flex justify-between items-start mb-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <h4 className="font-semibold text-gray-900 text-sm">{bill.title}</h4>
                                  {bill.payer && (
                                    <span className="text-[10px] bg-gray-100 px-1.5 py-0.5 rounded text-gray-600 font-medium whitespace-nowrap">
                                      {bill.payer} 付
                                    </span>
                                  )}
                                  {bill.image_url && (
                                    <svg className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                  )}
                                </div>
                              </div>
                              <span className="text-lg font-bold text-primary-600">
                                ${bill.total_amount.toFixed(0)}
                              </span>
                            </div>
                            <p className="text-xs text-gray-500">
                              {format(new Date(bill.bill_date), 'yyyy年MM月dd日', { locale: zhTW })}
                            </p>
                            <div className="flex gap-2 mt-2">
                              {user && (
                                <>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setPendingDeleteId(null) // 點擊檢核按鈕時取消待刪除狀態
                                      handleToggleChecked(bill.id, bill.checked)
                                    }}
                                    className={`text-xs px-2 py-1 rounded transition-colors ${bill.checked
                                      ? 'bg-green-200 text-green-800 hover:bg-green-300'
                                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                      }`}
                                  >
                                    {bill.checked ? '✓ 已檢核' : '○ 未檢核'}
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleDeleteBill(bill.id)
                                    }}
                                    className={`text-xs px-2 py-1 rounded transition-colors ${pendingDeleteId === bill.id
                                      ? 'bg-red-500 text-white hover:bg-red-600'
                                      : 'text-red-600 hover:text-red-800 hover:bg-red-50'
                                      }`}
                                  >
                                    {pendingDeleteId === bill.id ? '確認刪除' : '刪除'}
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {/* 滑動提示 */}
            {((viewMode === 'month' && monthGroups.length > 1) ||
              (viewMode === 'quarter' && quarterGroups.length > 1)) && (
                <div className="text-center mt-4 sm:mt-6 text-xs sm:text-sm text-gray-500">
                  ← 左右滑動查看更多 →
                </div>
              )}
          </div>
        )}
      </main>

      {/* Bill Detail Modal */}
      <BillDetailModal
        billId={selectedBillId}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
          setSelectedBillId(null)
        }}
        onSave={handleBillSave}
      />

      {/* 回到頂端按鈕 */}
      {showBackToTop && !isModalOpen && (
        <button
          onClick={scrollToTop}
          className="fixed bottom-4 right-4 sm:bottom-8 sm:right-8 bg-blue-600 text-white p-2.5 sm:p-3 rounded-full shadow-lg hover:bg-blue-700 transition-all z-50"
          aria-label="回到頂端"
        >
          <svg
            className="w-5 h-5 sm:w-6 sm:h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 10l7-7m0 0l7 7m-7-7v18"
            />
          </svg>
        </button>
      )}
    </div>
  )
}

