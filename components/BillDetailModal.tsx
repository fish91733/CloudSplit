'use client'

import React, { useEffect, useState, useRef } from 'react'
import BillEditor, { BillEditorRef } from './BillEditor'

interface BillDetailModalProps {
  billId: string | null
  isOpen: boolean
  onClose: () => void
  onSave?: (updatedBill: { id: string; title: string; total_amount: number; checked: boolean; payer: string }) => void
}

export default function BillDetailModal({ billId, isOpen, onClose, onSave }: BillDetailModalProps) {
  const [currentBillId, setCurrentBillId] = useState<string | null>(null)
  const [showBackToTop, setShowBackToTop] = useState(false)
  const [isBackdropMouseDown, setIsBackdropMouseDown] = useState(false)
  const modalContentRef = useRef<HTMLDivElement>(null)
  const billEditorRef = useRef<BillEditorRef>(null)

  const handleBackdropMouseDown = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setIsBackdropMouseDown(true)
    }
  }

  const handleBackdropMouseUp = (e: React.MouseEvent) => {
    if (isBackdropMouseDown && e.target === e.currentTarget) {
      if (billEditorRef.current?.isDirty) {
        if (!confirm('您有未儲存的變更，確定要離開嗎？')) {
          setIsBackdropMouseDown(false)
          return
        }
      }
      onClose()
    }
    setIsBackdropMouseDown(false)
  }

  // 當 Modal 打開時，更新 billId
  useEffect(() => {
    if (isOpen && billId) {
      setCurrentBillId(billId)
    } else if (!isOpen) {
      const timer = setTimeout(() => {
        setCurrentBillId(null)
        setShowBackToTop(false)
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [isOpen, billId])

  // 當按下 ESC 鍵時關閉
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        if (billEditorRef.current?.isDirty) {
          if (!confirm('您有未儲存的變更，確定要離開嗎？')) {
            return
          }
        }
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, onClose])

  // 監聽 Modal 內部滾動
  useEffect(() => {
    const handleScroll = () => {
      if (modalContentRef.current) {
        setShowBackToTop(modalContentRef.current.scrollTop > 300)
      }
    }

    const modalContent = modalContentRef.current
    if (modalContent && isOpen) {
      modalContent.addEventListener('scroll', handleScroll, { passive: true })
      handleScroll()
    }

    return () => {
      if (modalContent) {
        modalContent.removeEventListener('scroll', handleScroll)
      }
    }
  }, [isOpen, currentBillId])

  // 回到頂端
  const scrollToTop = () => {
    if (modalContentRef.current) {
      modalContentRef.current.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[2vh] bg-black bg-opacity-50"
      onMouseDown={handleBackdropMouseDown}
      onMouseUp={handleBackdropMouseUp}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-[98vw] h-[96vh] overflow-hidden flex flex-col relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Content - 這個 div 負責滾動 */}
        <div
          ref={modalContentRef}
          className="overflow-y-scroll flex-1"
        >
          {currentBillId ? (
            <BillEditor
              ref={billEditorRef}
              key={currentBillId}
              billId={currentBillId}
              isModal={true}
              onClose={onClose}
              onSave={onSave}
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-xl">載入中...</div>
            </div>
          )}
        </div>

        {/* 回到頂端按鈕 - 固定在 Modal 左下角 */}
        {showBackToTop && (
          <button
            onClick={scrollToTop}
            className="absolute bottom-4 left-4 bg-blue-600 text-white p-3 rounded-full shadow-lg hover:bg-blue-700 transition-all z-10"
            aria-label="回到頂端"
          >
            <svg
              className="w-5 h-5"
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
    </div>
  )
}
