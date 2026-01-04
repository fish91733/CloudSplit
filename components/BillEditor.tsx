'use client'

import { useState, useEffect, useMemo, forwardRef, useImperativeHandle, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { calculateShareAmount, formatCurrency } from '@/utils/calculations'
import BillImageDrawer from './BillImageDrawer'

interface Participant {
  id: string
  name: string
}

interface BillItem {
  id: string
  item_name: string
  unit_price: number
  discount_ratio: number
  discount_adjustment: number
  participantIds: string[]
  sort_order: number
}

interface ParticipantTotal {
  participantId: string
  name: string
  total: number
}

interface HistoryState {
  participants: Participant[]
  items: BillItem[]
}

interface BillEditorProps {
  billId?: string
  isModal?: boolean
  onClose?: () => void
}

export interface BillEditorRef {
  isDirty: boolean
}

const BillEditor = forwardRef<BillEditorRef, BillEditorProps>(({ billId, isModal = false, onClose }, ref) => {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [initialData, setInitialData] = useState<string>('') // 用於檢測是否有未儲存的變更
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [billDate, setBillDate] = useState(
    new Date().toISOString().split('T')[0]
  )
  const [checked, setChecked] = useState(false)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [newParticipantName, setNewParticipantName] = useState('')
  const [items, setItems] = useState<BillItem[]>([])
  const [canEdit, setCanEdit] = useState(true) // 權限控制
  const [isGuest, setIsGuest] = useState(false) // 訪客模式
  const [historyState, setHistoryState] = useState<HistoryState[]>([]) // Undo 歷史
  const [historyIndex, setHistoryIndex] = useState(-1) // 當前歷史索引
  const [showImportModal, setShowImportModal] = useState(false) // JSON 匯入模態框
  const [isDrawerOpen, setIsDrawerOpen] = useState(false) // 圖片抽屜狀態
  const [imageUrl, setImageUrl] = useState<string | null>(null) // 發票圖片 URL
  const [isImportModalBackdropMouseDown, setIsImportModalBackdropMouseDown] = useState(false)
  const [showBackToTop, setShowBackToTop] = useState(false) // 顯示至頂按鈕
  
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (billId) {
      // 立即清空舊資料，避免閃現
      setTitle('')
      setDescription('')
      setBillDate(new Date().toISOString().split('T')[0])
      setChecked(false)
      setParticipants([])
      setItems([])
      setCanEdit(false)
      setIsGuest(false)
      setHistoryState([])
      setHistoryIndex(-1)
      // 然後載入新資料
      loadBill()
    } else {
      // 新增模式：設定初始狀態
      const defaultDate = new Date().toISOString().split('T')[0]
      // 確保狀態也是預設值 (雖然 useState 已經設定了，但為了保險)
      setTitle('')
      setDescription('')
      setBillDate(defaultDate)
      setChecked(false)
      setParticipants([])
      setItems([])
      
      setInitialData(JSON.stringify({
          title: '',
          description: '',
          bill_date: defaultDate,
          checked: false,
          participants: [],
          items: []
      }))
    }
  }, [billId])

  // 處理錨點跳轉
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash) {
      const hash = window.location.hash.substring(1) // 移除 #
      if (hash.startsWith('item-')) {
        // 等待內容載入後再滾動
        const timer = setTimeout(() => {
          const element = document.getElementById(hash)
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' })
            // 添加高亮效果
            element.classList.add('ring-4', 'ring-blue-400', 'ring-opacity-50')
            setTimeout(() => {
              element.classList.remove('ring-4', 'ring-blue-400', 'ring-opacity-50')
            }, 2000)
          }
        }, 500) // 等待資料載入
        return () => clearTimeout(timer)
      }
    }
  }, [billId, items])

  // 監聯滾動，顯示/隱藏回到頂端按鈕（僅頁面模式）
  const handleScroll = () => {
    if (!isModal && scrollContainerRef.current) {
      setShowBackToTop(scrollContainerRef.current.scrollTop > 300)
    }
  }

  // 回到頂端（僅頁面模式）
  const scrollToTop = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  // 保存狀態到歷史（用於 Undo）
  const saveToHistory = (participantsState: Participant[], itemsState: BillItem[]) => {
    const newHistory: HistoryState = {
      participants: JSON.parse(JSON.stringify(participantsState)),
      items: JSON.parse(JSON.stringify(itemsState)),
    }
    // 移除當前索引之後的歷史
    const updatedHistory = historyState.slice(0, historyIndex + 1)
    updatedHistory.push(newHistory)
    // 限制歷史長度（最多保留 50 個狀態）
    if (updatedHistory.length > 50) {
      updatedHistory.shift()
    }
    setHistoryState(updatedHistory)
    setHistoryIndex(updatedHistory.length - 1)
  }

  // Undo 功能
  const handleUndo = () => {
    if (historyIndex > 0) {
      const prevState = historyState[historyIndex - 1]
      setParticipants(prevState.participants)
      setItems(prevState.items)
      setHistoryIndex(historyIndex - 1)
    }
  }

  const loadBill = async () => {
    setLoading(true)
    try {
      // 並行載入所有資料以大幅提升速度
      const [
        { data: { user } },
        billResult,
        participantsResult,
        itemsResult,
      ] = await Promise.all([
        // 1. 獲取用戶資訊
        supabase.auth.getUser(),
        // 2. 載入發票基本資訊（只選擇需要的欄位）
        supabase
          .from('bills')
          .select('id, title, description, bill_date, created_by, image_url, checked')
          .eq('id', billId)
          .single(),
        // 3. 載入參與者（只選擇需要的欄位）
        supabase
          .from('bill_participants')
          .select('id, name')
          .eq('bill_id', billId)
          .order('created_at'),
        // 4. 載入品項（只選擇需要的欄位）
        supabase
          .from('bill_items')
          .select('id, item_name, unit_price, discount_ratio, discount_adjustment, sort_order')
          .eq('bill_id', billId)
          .order('sort_order'),
      ])

      // 處理錯誤
      if (billResult.error) throw billResult.error
      if (participantsResult.error) throw participantsResult.error
      if (itemsResult.error) throw itemsResult.error

      const bill = billResult.data
      if (!bill) throw new Error('發票不存在')

      // 設置基本資訊
      setTitle(bill.title)
      setDescription(bill.description || '')
      setBillDate(bill.bill_date)
      setChecked(bill.checked || false)
      setImageUrl(bill.image_url || null)

      // 檢查權限：只有建立者可以編輯
      const canEditValue = user && bill.created_by === user.id
      if (!user) {
        // 訪客模式
        setIsGuest(true)
        setCanEdit(false)
      } else if (bill.created_by !== user.id) {
        // 不是建立者，只能查看
        setCanEdit(false)
      } else {
        // 是建立者，可以編輯
        setCanEdit(true)
      }

      // 處理參與者
      const loadedParticipants = participantsResult.data?.map((p) => ({ id: p.id, name: p.name })) || []
      setParticipants(loadedParticipants)

      // 如果有品項，並行載入所有 split_details
      const billItems = itemsResult.data || []
      let allSplits: any[] = []
      
      if (billItems.length > 0) {
        const itemIds = billItems.map((item) => item.id)
        const splitsResult = await supabase
          .from('split_details')
          .select('bill_item_id, participant_id')
          .in('bill_item_id', itemIds)

        if (splitsResult.error) throw splitsResult.error
        allSplits = splitsResult.data || []
      }

      // 建立 split details 的映射表以提高查找效率
      const splitsMap = new Map<string, string[]>()
      allSplits.forEach((split) => {
        if (!splitsMap.has(split.bill_item_id)) {
          splitsMap.set(split.bill_item_id, [])
        }
        splitsMap.get(split.bill_item_id)?.push(split.participant_id)
      })

      // 組合 items 和 splits
      const itemsWithSplits: BillItem[] = billItems.map((item, index) => ({
        id: item.id,
        item_name: item.item_name,
        unit_price: item.unit_price,
        discount_ratio: item.discount_ratio,
        discount_adjustment: item.discount_adjustment,
        participantIds: splitsMap.get(item.id) || [],
        sort_order: item.sort_order ?? index,
      }))

      setItems(itemsWithSplits)

      setInitialData(JSON.stringify({
          title: bill.title,
          description: bill.description || '',
          bill_date: bill.bill_date,
          checked: bill.checked || false,
          participants: loadedParticipants,
          items: itemsWithSplits
      }))
      
      // 初始化歷史（保存初始狀態）- 只在可編輯模式下才需要
      if (canEditValue) {
        const initialHistory: HistoryState = {
          participants: loadedParticipants.map(p => ({ ...p })),
          items: itemsWithSplits.map(item => ({ ...item, participantIds: [...item.participantIds] })),
        }
        setHistoryState([initialHistory])
        setHistoryIndex(0)
      }
    } catch (error: any) {
      console.error('Error loading bill:', error)
      // 檢查是否是 RLS 權限問題
      if (error?.message?.includes('permission denied') || error?.message?.includes('row-level security')) {
        alert('無法載入發票：請確認已在 Supabase 中執行訪客模式更新腳本（supabase_guest_mode_update.sql）')
      } else {
        alert(`載入失敗：${error?.message || '未知錯誤'}`)
      }
    } finally {
      setLoading(false)
    }
  }

  // 編輯參與者功能
  const [editingParticipantId, setEditingParticipantId] = useState<string | null>(null)
  const [editParticipantName, setEditParticipantName] = useState('')

  const startEditingParticipant = (p: Participant) => {
    setEditingParticipantId(p.id)
    setEditParticipantName(p.name)
  }

  const saveEditingParticipant = () => {
    if (!editingParticipantId || !editParticipantName.trim()) {
      setEditingParticipantId(null)
      return
    }

    // 檢查名稱是否重複 (排除自己)
    if (participants.some(p => p.name === editParticipantName.trim() && p.id !== editingParticipantId)) {
      alert('參與者名稱已存在')
      return
    }

    setParticipants(participants.map(p => 
      p.id === editingParticipantId 
        ? { ...p, name: editParticipantName.trim() } 
        : p
    ))
    setEditingParticipantId(null)
    setEditParticipantName('')
  }

  const addParticipant = () => {
    if (!newParticipantName.trim()) return
    if (participants.some((p) => p.name === newParticipantName.trim())) {
      alert('參與者名稱已存在')
      return
    }

    const tempId = `temp_${Date.now()}`
    setParticipants([
      ...participants,
      { id: tempId, name: newParticipantName.trim() },
    ])
    setNewParticipantName('')
  }

  const removeParticipant = (id: string) => {
    // 保存當前狀態到歷史（用於 Undo）
    saveToHistory(participants, items)
    
    const newParticipants = participants.filter((p) => p.id !== id)
    setParticipants(newParticipants)
    // Remove from all items
    const newItems = items.map((item) => ({
      ...item,
      participantIds: item.participantIds.filter((pid) => pid !== id),
    }))
    setItems(newItems)
  }

  const addItem = () => {
    const maxSortOrder = items.length > 0 ? Math.max(...items.map(i => i.sort_order)) : -1
    setItems([
      ...items,
      {
        id: `temp_${Date.now()}`,
        item_name: '',
        unit_price: 0,
        discount_ratio: 1.0,
        discount_adjustment: 0,
        participantIds: [],
        sort_order: maxSortOrder + 1,
      },
    ])
  }

  const updateItem = (id: string, field: keyof BillItem, value: any) => {
    setItems(
      items.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      )
    )
  }

  const toggleItemParticipant = (itemId: string, participantId: string) => {
    setItems(
      items.map((item) => {
        if (item.id !== itemId) return item
        const isSelected = item.participantIds.includes(participantId)
        return {
          ...item,
          participantIds: isSelected
            ? item.participantIds.filter((id) => id !== participantId)
            : [...item.participantIds, participantId],
        }
      })
    )
  }

  const removeItem = (id: string) => {
    setItems(items.filter((item) => item.id !== id))
  }

  const calculateParticipantTotals = (): ParticipantTotal[] => {
    const totals: { [key: string]: { name: string; total: number } } = {}

    participants.forEach((p) => {
      totals[p.id] = { name: p.name, total: 0 }
    })

    items.forEach((item) => {
      const shareCount = item.participantIds.length
      if (shareCount === 0) return

      const shareAmount = calculateShareAmount(
        item.unit_price,
        shareCount,
        item.discount_ratio,
        item.discount_adjustment
      )

      item.participantIds.forEach((participantId) => {
        if (totals[participantId]) {
          totals[participantId].total += shareAmount
        }
      })
    })

    return Object.entries(totals).map(([participantId, data]) => ({
      participantId,
      ...data,
    }))
  }

  const handleSave = async () => {
    if (!title.trim()) {
      alert('請輸入發票標題')
      return
    }

    if (participants.length === 0) {
      alert('請至少新增一個參與者')
      return
    }

    if (items.length === 0) {
      alert('請至少新增一個品項')
      return
    }

    setSaving(true)
    try {
      // 使用 getSession 比 getUser 更快
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) throw new Error('User not found')

      let currentBillId = billId

      // Create or update bill
      if (billId) {
        const { error } = await supabase
          .from('bills')
          .update({
            title: title.trim(),
            description: description.trim() || null,
            bill_date: billDate,
            checked: checked,
          })
          .eq('id', billId)

        if (error) throw error
        currentBillId = billId
      } else {
        const { data: newBill, error } = await supabase
          .from('bills')
          .insert({
            title: title.trim(),
            description: description.trim() || null,
            bill_date: billDate,
            created_by: user.id,
            total_amount: 0,
            checked: checked,
          })
          .select()
          .single()

        if (error) throw error
        currentBillId = newBill.id
      }

      // Handle participants
      let finalParticipants: any[] = []

      if (!billId) {
        // New bill: insert all participants
        const participantData = participants.map((p) => ({
          bill_id: currentBillId,
          name: p.name.trim(),
        }))

        const { data: inserted, error: participantsError } =
          await supabase
            .from('bill_participants')
            .insert(participantData)
            .select()

        if (participantsError) throw participantsError
        finalParticipants = inserted || []

        // Update participants with real IDs
        setParticipants(
          finalParticipants.map((p) => ({ id: p.id, name: p.name }))
        )
      } else {
        // Existing bill: Upsert (Update + Insert)
        
        // 1. Get current DB participants (for deletion check)
        const { data: currentParticipants, error: fetchError } = await supabase
          .from('bill_participants')
          .select('id')
          .eq('bill_id', currentBillId)
        
        if (fetchError) throw fetchError

        // 2. Upsert all participants
        // 分離新參與者和現有參與者
        const newParticipants = participants.filter(p => 
          p.id.startsWith('temp') || p.id.startsWith('temp_import')
        )
        const existingParticipants = participants.filter(p => 
          !p.id.startsWith('temp') && !p.id.startsWith('temp_import')
        )

        // 插入新參與者（不包含 id）
        if (newParticipants.length > 0) {
          const newParticipantData = newParticipants.map(p => ({
            bill_id: currentBillId,
            name: p.name.trim()
          }))

          const { data: inserted, error: insertError } = await supabase
            .from('bill_participants')
            .insert(newParticipantData)
            .select()

          if (insertError) throw insertError
          // 將新插入的參與者加入 finalParticipants
          finalParticipants.push(...(inserted || []))
        }

        // 更新現有參與者（包含 id）
        if (existingParticipants.length > 0) {
          const updateData = existingParticipants.map(p => ({
            id: p.id,
            bill_id: currentBillId,
            name: p.name.trim()
          }))

          const { data: updated, error: updateError } = await supabase
            .from('bill_participants')
            .upsert(updateData, { onConflict: 'id' })
            .select()

          if (updateError) throw updateError
          // 將更新的參與者加入 finalParticipants
          finalParticipants.push(...(updated || []))
        }

        // 3. Delete removed participants
        const upsertedIds = finalParticipants.map(p => p.id)
        const currentIds = currentParticipants?.map(p => p.id) || []
        const toDeleteIds = currentIds.filter(id => !upsertedIds.includes(id))

        if (toDeleteIds.length > 0) {
          const { error: deleteError } = await supabase
            .from('bill_participants')
            .delete()
            .in('id', toDeleteIds)

          if (deleteError) throw deleteError
        }

        // Update participants state
        setParticipants(finalParticipants.map(p => ({ id: p.id, name: p.name })))
      }

      // 建立參與者映射
      const participantMap = new Map<string, string>()
      finalParticipants.forEach((p) => {
        participantMap.set(p.name, p.id)
      })

      // 並行刪除現有資料（如果是編輯模式）
      if (billId) {
        const [existingItemsResult] = await Promise.all([
          supabase.from('bill_items').select('id').eq('bill_id', currentBillId),
        ])

        if (existingItemsResult.data && existingItemsResult.data.length > 0) {
          const itemIds = existingItemsResult.data.map((item) => item.id)
          // 並行刪除
          await Promise.all([
            supabase.from('split_details').delete().in('bill_item_id', itemIds),
            supabase.from('bill_items').delete().eq('bill_id', currentBillId),
          ])
        }
      }

      // 準備批量插入的資料
      const itemsToInsert: any[] = []
      const splitsToInsert: any[] = []
      let totalAmount = 0

      // 預處理所有品項資料
      for (let sortIndex = 0; sortIndex < items.length; sortIndex++) {
        const item = items[sortIndex]
        if (!item.item_name.trim() || item.unit_price <= 0) continue

        // Map participant names to IDs
        const participantIds = item.participantIds
          .map((pid) => {
            const p = participants.find((p) => p.id === pid)
            return p ? participantMap.get(p.name) : null
          })
          .filter((id): id is string => id !== null)

        const shareCount = participantIds.length
        if (shareCount === 0) continue

        const shareAmount = calculateShareAmount(
          item.unit_price,
          shareCount,
          item.discount_ratio,
          item.discount_adjustment
        )

        totalAmount += item.unit_price * item.discount_ratio + item.discount_adjustment

        itemsToInsert.push({
          bill_id: currentBillId,
          item_name: item.item_name.trim(),
          unit_price: item.unit_price,
          discount_ratio: item.discount_ratio,
          discount_adjustment: item.discount_adjustment,
          sort_order: sortIndex,
          participantIds, // 暫時保存，用於後續建立 split_details
          shareAmount,
        })
      }

      // 批量插入所有品項
      if (itemsToInsert.length > 0) {
        const { data: insertedItems, error: itemsError } = await supabase
          .from('bill_items')
          .insert(
            itemsToInsert.map(({ participantIds, shareAmount, ...item }) => item)
          )
          .select()

        if (itemsError) throw itemsError

        // 準備批量插入 split_details
        insertedItems?.forEach((billItem, index) => {
          const itemData = itemsToInsert[index]
          const splitData = itemData.participantIds.map((participantId: string) => ({
            bill_item_id: billItem.id,
            participant_id: participantId,
            share_amount: itemData.shareAmount,
          }))
          splitsToInsert.push(...splitData)
        })

        // 批量插入所有 split_details
        if (splitsToInsert.length > 0) {
          const { error: splitsError } = await supabase
            .from('split_details')
            .insert(splitsToInsert)

          if (splitsError) throw splitsError
        }
      }

      // Update bill total
      await supabase
        .from('bills')
        .update({ total_amount: totalAmount })
        .eq('id', currentBillId)

      // 如果是 modal 模式，關閉 modal 並刷新列表
      if (isModal && onClose) {
        onClose()
        // 觸發頁面刷新以更新列表
        window.location.reload()
      } else {
        router.push('/')
        router.refresh()
      }
    } catch (error: any) {
      console.error('Error saving bill:', error)
      alert('儲存失敗: ' + (error.message || '未知錯誤'))
    } finally {
      setSaving(false)
    }
  }

  const participantTotals = calculateParticipantTotals()

  const isDirty = useMemo(() => {
    if (!initialData) return false
    const currentData = {
      title,
      description,
      bill_date: billDate,
      checked,
      participants,
      items
    }
    return JSON.stringify(currentData) !== initialData
  }, [title, description, billDate, checked, participants, items, initialData])

  useImperativeHandle(ref, () => ({
    isDirty
  }), [isDirty])

  if (loading) {
    return (
      <div className={`${isModal ? 'h-full' : 'min-h-screen'} flex items-center justify-center`}>
        <div className="text-xl">載入中...</div>
      </div>
    )
  }

  const handleClose = () => {
    if (isDirty) {
      if (!confirm('您有未儲存的變更，確定要離開嗎？')) {
        return
      }
    }
    if (isModal && onClose) {
      onClose()
    } else {
      router.push('/')
    }
  }

  // 批量儲存多張發票
  const handleBatchSave = async (billsData: any[]) => {
    try {
      setSaving(true)
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) throw new Error('User not found')

      let successCount = 0
      let failCount = 0

      for (const billData of billsData) {
        try {
          // 驗證資料格式
          if (!billData.title || !billData.participants || !Array.isArray(billData.participants) || !billData.items || !Array.isArray(billData.items)) {
            failCount++
            continue
          }

          // 建立發票
          const { data: newBill, error: billError } = await supabase
            .from('bills')
            .insert({
              title: billData.title.trim(),
              description: billData.description?.trim() || null,
              bill_date: billData.bill_date || new Date().toISOString().split('T')[0],
              created_by: user.id,
              total_amount: 0,
            })
            .select()
            .single()

          if (billError) {
            failCount++
            continue
          }

          const currentBillId = newBill.id

          // 插入參與者
          const participantData = billData.participants.map((name: string) => ({
            bill_id: currentBillId,
            name: name.trim(),
          }))

          const { data: insertedParticipants, error: participantsError } =
            await supabase
              .from('bill_participants')
              .insert(participantData)
              .select()

          if (participantsError) {
            failCount++
            continue
          }

          // 建立參與者映射
          const participantMap = new Map<string, string>()
          insertedParticipants?.forEach((p) => {
            participantMap.set(p.name, p.id)
          })

          // 準備批量插入的資料
          const itemsToInsert: any[] = []
          const splitsToInsert: any[] = []
          let totalAmount = 0

          // 處理品項
          let sortOrderCounter = 0
          billData.items.forEach((item: any, index: number) => {
            const participantIds: string[] = (item.participants || []).map((name: string) => {
              return participantMap.get(name.trim()) || ''
            }).filter((id: string) => id !== '')

            const quantity = item.quantity || 1
            const unitPrice = item.unit_price || 0

            for (let i = 0; i < quantity; i++) {
              const shareCount = participantIds.length
              if (shareCount === 0) continue

              const shareAmount = calculateShareAmount(
                unitPrice,
                shareCount,
                item.discount_ratio || 1.0,
                i === 0 ? (item.discount_adjustment || 0) : 0
              )

              totalAmount += unitPrice * (item.discount_ratio || 1.0) + (i === 0 ? (item.discount_adjustment || 0) : 0)

              itemsToInsert.push({
                bill_id: currentBillId,
                item_name: quantity > 1 ? `${item.item_name} (${i + 1}/${quantity})` : item.item_name || '',
                unit_price: unitPrice,
                discount_ratio: item.discount_ratio || 1.0,
                discount_adjustment: i === 0 ? (item.discount_adjustment || 0) : 0,
                sort_order: sortOrderCounter++,
                participantIds,
                shareAmount,
              })
            }
          })

          // 批量插入品項
          if (itemsToInsert.length > 0) {
            const { data: insertedItems, error: itemsError } = await supabase
              .from('bill_items')
              .insert(
                itemsToInsert.map(({ participantIds, shareAmount, ...item }) => item)
              )
              .select()

            if (itemsError) {
              failCount++
              continue
            }

            // 準備批量插入 split_details
            insertedItems?.forEach((billItem, index) => {
              const itemData = itemsToInsert[index]
              const splitData = itemData.participantIds.map((participantId: string) => ({
                bill_item_id: billItem.id,
                participant_id: participantId,
                share_amount: itemData.shareAmount,
              }))
              splitsToInsert.push(...splitData)
            })

            // 批量插入 split_details
            if (splitsToInsert.length > 0) {
              const { error: splitsError } = await supabase
                .from('split_details')
                .insert(splitsToInsert)

              if (splitsError) {
                failCount++
                continue
              }
            }

            // 更新總金額
            await supabase
              .from('bills')
              .update({ total_amount: totalAmount })
              .eq('id', currentBillId)
          }

          successCount++
        } catch (error) {
          failCount++
          console.error('Error saving bill:', error)
        }
      }

      setShowImportModal(false)
      
      if (successCount > 0) {
        alert(`成功匯入 ${successCount} 張發票${failCount > 0 ? `，${failCount} 張失敗` : ''}`)
        if (isModal && onClose) {
          onClose()
          window.location.reload()
        } else {
          router.push('/')
          router.refresh()
        }
      } else {
        alert(`匯入失敗：所有發票都無法建立`)
      }
    } catch (error: any) {
      console.error('Error batch saving:', error)
      alert(`批量匯入失敗：${error.message || '未知錯誤'}`)
    } finally {
      setSaving(false)
    }
  }

  // JSON 匯入功能
  const handleImportJSON = (jsonData: string) => {
    try {
      const data = JSON.parse(jsonData)

      // 判斷是陣列還是單一物件
      const billsData = Array.isArray(data) ? data : [data]

      // 如果是陣列且有多張發票，使用批量儲存
      if (billsData.length > 1) {
        handleBatchSave(billsData)
        return
      }

      // 單一發票：載入到編輯器
      const billData = billsData[0]

      // 驗證資料格式
      if (!billData.title || !billData.participants || !Array.isArray(billData.participants) || !billData.items || !Array.isArray(billData.items)) {
        throw new Error('JSON 格式錯誤：缺少必要欄位')
      }

      // 設置基本資訊
      setTitle(billData.title || '')
      setDescription(billData.description || '')
      setBillDate(billData.bill_date || new Date().toISOString().split('T')[0])

      // 設置參與者（使用臨時 ID）
      const importedParticipants: Participant[] = billData.participants.map((name: string, index: number) => ({
        id: `temp_import_${index}`,
        name: name.trim(),
      }))
      setParticipants(importedParticipants)

      // 建立參與者名稱到 ID 的映射
      const participantMap = new Map<string, string>()
      importedParticipants.forEach((p) => {
        participantMap.set(p.name, p.id)
      })

      // 設置品項
      const importedItems: BillItem[] = []
      let sortOrderCounter = 0
      billData.items.forEach((item: any, index: number) => {
        // 處理參與者名稱到 ID 的轉換
        const participantIds: string[] = (item.participants || []).map((name: string) => {
          return participantMap.get(name.trim()) || ''
        }).filter((id: string) => id !== '')

        const quantity = item.quantity || 1
        const unitPrice = item.unit_price || 0

        // 如果有多個數量，為每個數量創建一個品項（因為系統中每個品項代表一個單位）
        for (let i = 0; i < quantity; i++) {
          importedItems.push({
            id: `temp_item_${index}_${i}`,
            item_name: quantity > 1 ? `${item.item_name} (${i + 1}/${quantity})` : item.item_name || '',
            unit_price: unitPrice,
            discount_ratio: item.discount_ratio || 1.0,
            discount_adjustment: i === 0 ? (item.discount_adjustment || 0) : 0, // 只在第一個品項應用折扣調整
            participantIds: participantIds,
            sort_order: sortOrderCounter++,
          })
        }
      })

      setItems(importedItems)
      setShowImportModal(false)

      alert('JSON 匯入成功！')
    } catch (error: any) {
      console.error('Error importing JSON:', error)
      alert(`匯入失敗：${error.message || 'JSON 格式錯誤'}`)
    }
  }

  const handleImportFromFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target?.result as string
      if (content) {
        handleImportJSON(content)
      }
    }
    reader.onerror = () => {
      alert('讀取檔案失敗')
    }
    reader.readAsText(file)
  }

  const handleImageUploaded = async (url: string) => {
    if (!billId) return
    
    try {
      const { error } = await supabase
        .from('bills')
        .update({ image_url: url })
        .eq('id', billId)

      if (error) throw error
      setImageUrl(url)
    } catch (error) {
      console.error('Error updating bill image:', error)
      alert('更新圖片連結失敗')
    }
  }

  const handleImageDeleted = async () => {
    if (!billId) return

    try {
      const { error } = await supabase
        .from('bills')
        .update({ image_url: null })
        .eq('id', billId)

      if (error) throw error
      setImageUrl(null)
    } catch (error) {
      console.error('Error removing bill image:', error)
      alert('移除圖片連結失敗')
    }
  }

  return (
    <div 
      className={`flex flex-col sm:flex-row ${
        isModal ? 'bg-white' : 'h-screen overflow-hidden bg-gray-50'
      }`}
    >
      <div 
        ref={isModal ? undefined : scrollContainerRef}
        onScroll={isModal ? undefined : handleScroll}
        className={`flex-1 min-w-0 flex flex-col relative ${isModal ? '' : 'min-h-0 overflow-y-auto'}`}
      >
      {/* Header */}
      <header className={`bg-white shadow-sm border-b sticky top-0 z-20 backdrop-blur-sm bg-white/95`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <button
              onClick={handleClose}
              className="text-gray-600 hover:text-gray-900"
            >
              {isModal ? '× 關閉' : '← 返回'}
            </button>
            <h1 className="text-xl font-bold text-gray-900">
              {billId ? (canEdit ? '編輯發票' : '查看發票') : '新增發票'}
              {isGuest && <span className="ml-2 text-sm text-gray-500">(訪客模式)</span>}
              {!canEdit && !isGuest && <span className="ml-2 text-sm text-gray-500">(唯讀)</span>}
            </h1>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (!billId) {
                    alert('請先儲存發票草稿，才能上傳/查看圖片')
                    return
                  }
                  setIsDrawerOpen(!isDrawerOpen)
                }}
                className={`px-3 py-2 rounded-lg transition-colors font-medium flex items-center gap-1 ${
                  isDrawerOpen
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : imageUrl 
                      ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' 
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                title="發票圖片"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="hidden sm:inline">
                  {isDrawerOpen ? '關閉圖片' : (imageUrl ? '查看圖片' : '上傳圖片')}
                </span>
              </button>
              
              {!billId && canEdit && (
                <button
                  onClick={() => setShowImportModal(true)}
                  className="px-4 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors font-medium"
                  title="從 JSON 匯入"
                >
                  📥 匯入 JSON
                </button>
              )}
              {historyIndex > 0 && canEdit && (
                <button
                  onClick={handleUndo}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                  title="復原上一步"
                >
                  ↶ 復原
                </button>
              )}
              <button
                onClick={handleSave}
                disabled={saving || !canEdit}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {saving ? '儲存中...' : canEdit ? '儲存' : '無編輯權限'}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 ${isModal ? 'py-4' : 'py-6'}`}>
        <div className="space-y-6">
          {/* Basic Info */}
          <div className={`${isModal ? 'bg-transparent' : 'bg-white rounded-lg shadow'} p-6`}>
            <h2 className="text-lg font-semibold mb-4">基本資訊</h2>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
              <div className="md:col-span-6">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  發票標題 *
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={!canEdit}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
                  placeholder="例如：2024年1月聚餐"
                  required
                />
              </div>
              <div className="md:col-span-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  日期 *
                </label>
                <input
                  type="date"
                  value={billDate}
                  onChange={(e) => setBillDate(e.target.value)}
                  disabled={!canEdit}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
                  required
                />
              </div>
              <div className="md:col-span-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  狀態
                </label>
                <div className="flex items-center h-[42px]">
                  <label className="inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={checked}
                      onChange={(e) => setChecked(e.target.checked)}
                      disabled={!canEdit}
                    />
                    <div className="relative w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-success-500"></div>
                    <span className="ms-3 text-sm font-medium text-gray-700">
                      {checked ? '已核對' : '未核對'}
                    </span>
                  </label>
                </div>
              </div>
              <div className="md:col-span-12">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  備註
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={!canEdit}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
                  rows={2}
                  placeholder="選填"
                />
              </div>
            </div>
          </div>

          {/* Items Summary Table */}
          {items.length > 0 && (
            <div className={`${isModal ? 'bg-transparent border border-gray-200' : 'bg-white rounded-lg shadow'} p-4 sm:p-6`}>
              <h2 className="text-lg font-semibold mb-4">品項明細總覽</h2>
              
              {/* 手機版：卡片布局 */}
              <div className="block md:hidden space-y-3">
                {items.map((item) => {
                  const shareCount = item.participantIds.length
                  const shareAmount = shareCount > 0
                    ? calculateShareAmount(
                        item.unit_price,
                        shareCount,
                        item.discount_ratio,
                        item.discount_adjustment
                      )
                    : 0
                  const itemTotal = item.unit_price * item.discount_ratio + item.discount_adjustment
                  const discountAmount = item.unit_price * (1 - item.discount_ratio)
                  const participantNames = item.participantIds
                    .map((pid) => participants.find((p) => p.id === pid)?.name)
                    .filter(Boolean)
                    .join(', ')

                  return (
                    <div
                      key={item.id}
                      className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2"
                    >
                      <div className="flex items-start justify-between">
                        <button
                          onClick={() => {
                            const element = document.getElementById(`item-${item.id}`)
                            if (element) {
                              element.scrollIntoView({ behavior: 'smooth', block: 'start' })
                              element.classList.add('ring-4', 'ring-blue-400', 'ring-opacity-50')
                              setTimeout(() => {
                                element.classList.remove('ring-4', 'ring-blue-400', 'ring-opacity-50')
                              }, 2000)
                            }
                          }}
                          className="text-blue-600 hover:text-blue-800 hover:underline text-left font-medium text-sm flex-1"
                        >
                          {item.item_name || <span className="text-gray-400">未命名品項</span>}
                        </button>
                        <div className="text-right">
                          <div className="text-sm font-semibold text-primary-600">
                            {formatCurrency(itemTotal)}
                          </div>
                          <div className="text-xs text-gray-500">小計</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-gray-500">單價：</span>
                          <span className="text-gray-700 ml-1">{formatCurrency(item.unit_price)}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">折扣比：</span>
                          <span className="text-gray-700 ml-1">{item.discount_ratio.toFixed(2)}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">折扣金額：</span>
                          {discountAmount > 0 ? (
                            <span className="text-red-600 ml-1">-{formatCurrency(discountAmount)}</span>
                          ) : (
                            <span className="text-gray-400 ml-1">-</span>
                          )}
                        </div>
                        <div>
                          <span className="text-gray-500">折扣調整：</span>
                          {item.discount_adjustment !== 0 ? (
                            item.discount_adjustment > 0 ? (
                              <span className="text-green-600 ml-1">+{formatCurrency(item.discount_adjustment)}</span>
                            ) : (
                              <span className="text-red-600 ml-1">{formatCurrency(item.discount_adjustment)}</span>
                            )
                          ) : (
                            <span className="text-gray-400 ml-1">-</span>
                          )}
                        </div>
                        <div>
                          <span className="text-gray-500">分擔人：</span>
                          <span className="text-gray-700 ml-1">{participantNames || '無'}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">每人分擔：</span>
                          <span className="text-gray-700 font-medium ml-1">
                            {shareCount > 0 ? formatCurrency(shareAmount) : '-'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}
                
                {/* 手機版總計 */}
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2 mt-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">折扣金額合計：</span>
                    <span className="text-sm text-red-600 font-medium">
                      -{formatCurrency(
                        items.reduce((sum, item) => {
                          return sum + item.unit_price * (1 - item.discount_ratio)
                        }, 0)
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between items-center border-t border-gray-300 pt-2">
                    <span className="text-base font-semibold text-gray-700">總計：</span>
                    <span className="text-lg font-bold text-primary-600">
                      {formatCurrency(
                        items.reduce((sum, item) => {
                          return sum + (item.unit_price * item.discount_ratio + item.discount_adjustment)
                        }, 0)
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {/* 桌面版：表格布局 */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 px-3 font-semibold text-gray-700">品項名稱</th>
                      <th className="text-right py-2 px-3 font-semibold text-gray-700">單價</th>
                      <th className="text-right py-2 px-3 font-semibold text-gray-700">折扣比</th>
                      <th className="text-right py-2 px-3 font-semibold text-gray-700">折扣金額</th>
                      <th className="text-right py-2 px-3 font-semibold text-gray-700">折扣調整</th>
                      <th className="text-center py-2 px-3 font-semibold text-gray-700">分擔人</th>
                      <th className="text-right py-2 px-3 font-semibold text-gray-700">每人分擔</th>
                      <th className="text-right py-2 px-3 font-semibold text-gray-700">小計</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const shareCount = item.participantIds.length
                      const shareAmount = shareCount > 0
                        ? calculateShareAmount(
                            item.unit_price,
                            shareCount,
                            item.discount_ratio,
                            item.discount_adjustment
                          )
                        : 0
                      const itemTotal = item.unit_price * item.discount_ratio + item.discount_adjustment
                      const discountAmount = item.unit_price * (1 - item.discount_ratio)
                      const participantNames = item.participantIds
                        .map((pid) => participants.find((p) => p.id === pid)?.name)
                        .filter(Boolean)
                        .join(', ')

                      return (
                        <tr
                          key={item.id}
                          className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                        >
                          <td className="py-2 px-3 text-gray-900 font-medium">
                            <button
                              onClick={() => {
                                const element = document.getElementById(`item-${item.id}`)
                                if (element) {
                                  element.scrollIntoView({ behavior: 'smooth', block: 'start' })
                                  element.classList.add('ring-4', 'ring-blue-400', 'ring-opacity-50')
                                  setTimeout(() => {
                                    element.classList.remove('ring-4', 'ring-blue-400', 'ring-opacity-50')
                                  }, 2000)
                                }
                              }}
                              className="text-blue-600 hover:text-blue-800 hover:underline text-left"
                            >
                              {item.item_name || <span className="text-gray-400">未命名品項</span>}
                            </button>
                          </td>
                          <td className="py-2 px-3 text-right text-gray-700">
                            {formatCurrency(item.unit_price)}
                          </td>
                          <td className="py-2 px-3 text-right text-gray-700">
                            {item.discount_ratio.toFixed(2)}
                          </td>
                          <td className="py-2 px-3 text-right text-gray-700">
                            {discountAmount > 0 ? (
                              <span className="text-red-600">-{formatCurrency(discountAmount)}</span>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right text-gray-700">
                            {item.discount_adjustment !== 0 ? (
                              item.discount_adjustment > 0 ? (
                                <span className="text-green-600">+{formatCurrency(item.discount_adjustment)}</span>
                              ) : (
                                <span className="text-red-600">{formatCurrency(item.discount_adjustment)}</span>
                              )
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-center text-gray-700">
                            {participantNames ? (
                              <span className="text-xs">{participantNames}</span>
                            ) : (
                              <span className="text-gray-400 text-xs">無</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right text-gray-700 font-medium">
                            {shareCount > 0 ? formatCurrency(shareAmount) : <span className="text-gray-400">-</span>}
                          </td>
                          <td className="py-2 px-3 text-right text-gray-900 font-semibold">
                            {formatCurrency(itemTotal)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-gray-200 text-gray-600">
                      <td colSpan={3} className="py-2 px-3 text-right text-sm">
                        折扣金額合計：
                      </td>
                      <td className="py-2 px-3 text-right text-sm text-red-600 font-medium">
                        -{formatCurrency(
                          items.reduce((sum, item) => {
                            return sum + item.unit_price * (1 - item.discount_ratio)
                          }, 0)
                        )}
                      </td>
                      <td colSpan={4}></td>
                    </tr>
                    <tr className="border-t-2 border-gray-300 bg-gray-50">
                      <td colSpan={7} className="py-3 px-3 text-right font-semibold text-gray-700">
                        總計：
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-lg text-primary-600">
                        {formatCurrency(
                          items.reduce((sum, item) => {
                            return sum + (item.unit_price * item.discount_ratio + item.discount_adjustment)
                          }, 0)
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Participants */}
          <div className={`${isModal ? 'bg-transparent border border-gray-200' : 'bg-white rounded-lg shadow'} p-6`}>
            <h2 className="text-lg font-semibold mb-4">參與者</h2>
            <div className="flex flex-wrap gap-2 mb-4">
              {participants.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 bg-primary-100 text-primary-700 px-3 py-1 rounded-full"
                >
                  {editingParticipantId === p.id ? (
                    <input
                      type="text"
                      value={editParticipantName}
                      onChange={(e) => setEditParticipantName(e.target.value)}
                      onBlur={saveEditingParticipant}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEditingParticipant()
                        if (e.key === 'Escape') setEditingParticipantId(null)
                      }}
                      autoFocus
                      className="bg-white border-primary-300 rounded px-1 py-0 text-sm focus:ring-1 focus:ring-primary-500 outline-none w-20"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span 
                      onClick={() => canEdit && startEditingParticipant(p)}
                      className={canEdit ? "cursor-pointer hover:underline decoration-dashed decoration-primary-400 underline-offset-4" : ""}
                      title={canEdit ? "點擊編輯名稱" : ""}
                    >
                      {p.name}
                    </span>
                  )}
                  {canEdit && editingParticipantId !== p.id && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        removeParticipant(p.id)
                      }}
                      className="text-primary-600 hover:text-primary-800"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
            {canEdit && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newParticipantName}
                  onChange={(e) => setNewParticipantName(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addParticipant()}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="輸入參與者名稱"
                />
                <button
                  onClick={addParticipant}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                >
                  新增
                </button>
              </div>
            )}
          </div>

          {/* Items */}
          <div className={`${isModal ? 'bg-transparent border border-gray-200' : 'bg-white rounded-lg shadow'} p-6`}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">品項明細</h2>
              {canEdit && (
                <button
                  onClick={addItem}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium"
                >
                  + 新增品項
                </button>
              )}
            </div>

            <div className="space-y-4">
              {items.map((item, index) => (
                <div
                  key={item.id}
                  id={`item-${item.id}`}
                  className="border border-gray-200 rounded-lg p-4 space-y-3 scroll-mt-20"
                >
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        品項名稱
                      </label>
                      <input
                        type="text"
                        value={item.item_name}
                        onChange={(e) =>
                          updateItem(item.id, 'item_name', e.target.value)
                        }
                        disabled={!canEdit}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"
                        placeholder="例如：紅茶"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        單價
                      </label>
                      <input
                        type="number"
                        value={item.unit_price || ''}
                        onChange={(e) =>
                          updateItem(
                            item.id,
                            'unit_price',
                            parseFloat(e.target.value) || 0
                          )
                        }
                        disabled={!canEdit}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"
                        placeholder="0"
                        min="0"
                        step="0.01"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        折扣比
                      </label>
                      <input
                        type="number"
                        value={item.discount_ratio || 1.0}
                        onChange={(e) =>
                          updateItem(
                            item.id,
                            'discount_ratio',
                            parseFloat(e.target.value) || 1.0
                          )
                        }
                        disabled={!canEdit}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"
                        placeholder="1.0"
                        min="0"
                        step="0.01"
                      />
                      {canEdit && (
                        <div className="flex gap-1 mt-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              updateItem(item.id, 'discount_ratio', 0.9)
                            }
                            className={`flex-1 px-2 py-1 text-xs font-medium rounded transition-colors ${
                              item.discount_ratio === 0.9
                                ? 'bg-primary-600 text-white'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                            title="90% (0.9)"
                          >
                            0.9
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateItem(item.id, 'discount_ratio', 1.0)
                            }
                            className={`flex-1 px-2 py-1 text-xs font-medium rounded transition-colors ${
                              item.discount_ratio === 1.0
                                ? 'bg-primary-600 text-white'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                            title="100% (1.0)"
                          >
                            1.0
                          </button>
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        折扣調整
                      </label>
                      <input
                        type="number"
                        value={item.discount_adjustment || 0}
                        onChange={(e) =>
                          updateItem(
                            item.id,
                            'discount_adjustment',
                            parseFloat(e.target.value) || 0
                          )
                        }
                        disabled={!canEdit}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"
                        placeholder="0"
                        step="0.01"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      分擔人（可多選）
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {participants.map((p) => {
                        const isSelected = item.participantIds.includes(p.id)
                        return (
                          <button
                            key={p.id}
                            onClick={() => canEdit && toggleItemParticipant(item.id, p.id)}
                            disabled={!canEdit}
                            className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                              isSelected
                                ? 'bg-primary-600 text-white'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            } ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            {p.name}
                          </button>
                        )
                      })}
                    </div>
                    {item.participantIds.length > 0 && (
                      <p className="mt-2 text-sm text-gray-600">
                        每人分擔:{' '}
                        {formatCurrency(
                          calculateShareAmount(
                            item.unit_price,
                            item.participantIds.length,
                            item.discount_ratio,
                            item.discount_adjustment
                          )
                        )}
                      </p>
                    )}
                  </div>

                  {canEdit && (
                    <button
                      onClick={() => removeItem(item.id)}
                      className="text-sm text-red-600 hover:text-red-800"
                    >
                      刪除此品項
                    </button>
                  )}
                </div>
              ))}

              {items.length === 0 && (
                <p className="text-center text-gray-500 py-8">
                  尚未新增任何品項
                </p>
              )}
            </div>
          </div>

          {/* Summary */}
          {participantTotals.length > 0 && (
            <div className={`${isModal ? 'bg-transparent border border-gray-200' : 'bg-white rounded-lg shadow'} p-6 ${isModal ? '' : 'sticky bottom-0'}`}>
              <h2 className="text-lg font-semibold mb-4">結算總計</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {participantTotals.map((total) => (
                  <div
                    key={total.participantId}
                    className="flex justify-between items-center p-3 bg-gray-50 rounded-lg"
                  >
                    <span className="font-medium text-gray-700">
                      {total.name}
                    </span>
                    <span className="text-lg font-bold text-primary-600">
                      {formatCurrency(total.total)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 回到頂端按鈕 - 僅頁面模式顯示，Modal 模式由 BillDetailModal 處理 */}
          {!isModal && showBackToTop && (
            <div className="sticky bottom-4 flex justify-end pointer-events-none z-30">
              <button
                onClick={scrollToTop}
                className="bg-blue-600 text-white p-3 rounded-full shadow-lg hover:bg-blue-700 transition-all pointer-events-auto"
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
            </div>
          )}
        </div>
      </main>

      {/* JSON 匯入模態框 */}
      {showImportModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setIsImportModalBackdropMouseDown(true)
          }}
          onMouseUp={(e) => {
            if (isImportModalBackdropMouseDown && e.target === e.currentTarget) {
              setShowImportModal(false)
            }
            setIsImportModalBackdropMouseDown(false)
          }}
        >
          <div
            className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-gray-200">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold text-gray-900">匯入 JSON</h2>
                <button
                  onClick={() => setShowImportModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    方式 1：上傳 JSON 檔案
                  </label>
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleImportFromFile}
                    className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
                  />
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-300"></div>
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-white text-gray-500">或</span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    方式 2：貼上 JSON 內容
                  </label>
                  <textarea
                    id="json-input"
                    className="w-full h-64 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent font-mono text-sm"
                    placeholder="貼上 JSON 內容..."
                  />
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm text-blue-800 font-medium mb-2">JSON 格式範例：</p>
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs text-blue-700 font-medium mb-1">單一發票：</p>
                      <pre className="text-xs text-blue-700 overflow-x-auto">
{`{
  "title": "發票標題",
  "description": "備註（選填）",
  "bill_date": "2025-02-03",
  "participants": ["S", "P", "B"],
  "items": [
    {
      "item_name": "品項名稱",
      "unit_price": 100,
      "quantity": 1,
      "discount_ratio": 1.0,
      "discount_adjustment": 0,
      "participants": ["S", "P"]
    }
  ]
}`}
                      </pre>
                    </div>
                    <div>
                      <p className="text-xs text-blue-700 font-medium mb-1">多張發票（陣列）：</p>
                      <pre className="text-xs text-blue-700 overflow-x-auto">
{`[
  {
    "title": "發票1",
    "bill_date": "2025-02-03",
    "participants": ["S", "P"],
    "items": [...]
  },
  {
    "title": "發票2",
    "bill_date": "2025-02-04",
    "participants": ["B", "F"],
    "items": [...]
  }
]`}
                      </pre>
                    </div>
                    <div className="mt-2 pt-2 border-t border-blue-200">
                      <p className="text-xs text-blue-600">
                        <span className="font-medium">💡 提示：</span> 品項會按照 JSON 中的順序儲存和顯示
                      </p>
                    </div>
                  </div>
                </div>

                {/* AI Prompt 準則說明 */}
                <details className="bg-amber-50 border border-amber-200 rounded-lg">
                  <summary className="p-4 cursor-pointer text-sm text-amber-800 font-medium hover:bg-amber-100 rounded-lg transition-colors">
                    🤖 AI 收據轉換 Prompt 準則（點擊展開）
                  </summary>
                  <div className="px-4 pb-4 text-xs text-amber-700 space-y-3">
                    <div>
                      <p className="font-semibold text-amber-800 mb-1">📋 任務目標</p>
                      <p>將收據圖片（或 OCR 文字）精確轉換為結構化的 JSON 格式，用於後續的分攤費用計算。必須嚴格遵守資料完整性、參與者判讀及折扣邏輯。</p>
                    </div>
                    
                    <div>
                      <p className="font-semibold text-amber-800 mb-1">📦 JSON 資料架構</p>
                      <ul className="list-disc list-inside space-y-1 ml-2">
                        <li><code className="bg-amber-100 px-1 rounded">title</code>: 格式為 [流水號] - [店名]。流水號取自圖片檔名末尾數字</li>
                        <li><code className="bg-amber-100 px-1 rounded">description</code>: 備註該收據的特殊折扣情況</li>
                        <li><code className="bg-amber-100 px-1 rounded">bill_date</code>: 格式為 YYYY-MM-DD</li>
                        <li><code className="bg-amber-100 px-1 rounded">participants</code>: 該張收據所有參與者的清單</li>
                        <li><code className="bg-amber-100 px-1 rounded">items</code>: 品項明細陣列</li>
                      </ul>
                    </div>

                    <div>
                      <p className="font-semibold text-amber-800 mb-1">🛒 品項明細 (items) 規則</p>
                      <ul className="list-disc list-inside space-y-1 ml-2">
                        <li><code className="bg-amber-100 px-1 rounded">item_name</code>: 品項名稱</li>
                        <li><code className="bg-amber-100 px-1 rounded">unit_price</code>: 單價（原價）</li>
                        <li><code className="bg-amber-100 px-1 rounded">quantity</code>: 數量（建議填 1，多數量請拆成多筆）</li>
                        <li><code className="bg-amber-100 px-1 rounded">discount_ratio</code>: 折扣比例（9折填 0.9，無折扣填 1.0）</li>
                        <li><code className="bg-amber-100 px-1 rounded">discount_adjustment</code>: 折扣金額（促銷折抵填負值，如 -10）</li>
                        <li><code className="bg-amber-100 px-1 rounded">participants</code>: 該品項的分攤人員</li>
                      </ul>
                    </div>

                    <div>
                      <p className="font-semibold text-amber-800 mb-1">⚠️ 關鍵作業準則</p>
                      <div className="space-y-2 ml-2">
                        <div>
                          <p className="font-medium">A. 人員判讀準則</p>
                          <ul className="list-disc list-inside ml-2">
                            <li>嚴格區分「3」與「S」：手寫標記中，數字「3」與字母「S」代表不同人員</li>
                            <li>根據收據上人員標記的位置，將該人員填入對應品項的 participants</li>
                          </ul>
                        </div>
                        <div>
                          <p className="font-medium">B. 折扣處理邏輯 (Adjustment 優先於 Ratio)</p>
                          <ul className="list-disc list-inside ml-2">
                            <li>專屬促銷優先：若有特定促銷（飲料聯促、鮮食促等），ratio 設 1.0，金額填入 adjustment</li>
                            <li>一般折扣次之：若僅有全館折扣（如 9 折），ratio 填 0.9，adjustment 設 0</li>
                            <li>無重複計算：享有專屬促銷的品項通常不再計算全館折扣</li>
                          </ul>
                        </div>
                        <div>
                          <p className="font-medium">C. 品項拆解要求</p>
                          <ul className="list-disc list-inside ml-2">
                            <li>禁止 Grouping：即使相同品項也必須根據數量拆分成單一物件</li>
                            <li>❌ 錯誤：{`"item_name": "紅茶", "quantity": 2`}</li>
                            <li>✅ 正確：拆成兩個 {`"quantity": 1`} 的物件</li>
                          </ul>
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-amber-200">
                      <p className="text-amber-600 italic">💡 將以上準則提供給 AI Agent 或設定為 System Prompt，可確保精確執行資料轉換</p>
                    </div>
                  </div>
                </details>
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setShowImportModal(false)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => {
                  const textarea = document.getElementById('json-input') as HTMLTextAreaElement
                  if (textarea?.value) {
                    handleImportJSON(textarea.value)
                  } else {
                    alert('請輸入 JSON 內容')
                  }
                }}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
              >
                匯入
              </button>
            </div>
          </div>
        </div>
      )}
      </div>

      <BillImageDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        billId={billId}
        initialImageUrl={imageUrl}
        onImageUploaded={handleImageUploaded}
        onImageDeleted={handleImageDeleted}
        readOnly={!canEdit}
        inline={true}
      />
    </div>
  )
})

BillEditor.displayName = 'BillEditor'
export default BillEditor

