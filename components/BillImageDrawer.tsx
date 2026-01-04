'use client'

import React, { useState, useRef, useEffect } from 'react'
import { uploadBillImage, deleteBillImage } from '@/utils/upload'

interface BillImageDrawerProps {
  isOpen: boolean
  onClose: () => void
  billId?: string
  initialImageUrl?: string | null
  onImageUploaded: (url: string) => void
  onImageDeleted: () => void
  readOnly?: boolean
  inline?: boolean
}

export default function BillImageDrawer({
  isOpen,
  onClose,
  billId,
  initialImageUrl,
  onImageUploaded,
  onImageDeleted,
  readOnly = false,
  inline = false,
}: BillImageDrawerProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(initialImageUrl || null)
  const [uploading, setUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDraggingImage, setIsDraggingImage] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })

  useEffect(() => {
    setImageUrl(initialImageUrl || null)
    setScale(1)
    setPosition({ x: 0, y: 0 })
  }, [initialImageUrl])

  const handleZoomIn = () => setScale(s => Math.min(s + 0.5, 5))
  const handleZoomOut = () => setScale(s => Math.max(1, s - 0.5))
  const handleResetZoom = () => {
    setScale(1)
    setPosition({ x: 0, y: 0 })
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale > 1) {
      setIsDraggingImage(true)
      dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y }
      e.preventDefault()
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDraggingImage && scale > 1) {
      setPosition({
        x: e.clientX - dragStart.current.x,
        y: e.clientY - dragStart.current.y
      })
    }
  }

  const handleMouseUp = () => {
    setIsDraggingImage(false)
  }

  const handleMouseLeave = () => {
    setIsDraggingImage(false)
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      await handleUpload(e.target.files[0])
    }
  }

  const handleUpload = async (file: File) => {
    if (!billId) {
      alert('請先儲存發票草稿，才能上傳圖片')
      return
    }

    setUploading(true)
    try {
      // 如果已有舊圖片，先刪除（選擇性，看是否要保留歷史）
      if (imageUrl) {
        await deleteBillImage(imageUrl)
      }

      const publicUrl = await uploadBillImage(file, billId)
      if (publicUrl) {
        setImageUrl(publicUrl)
        onImageUploaded(publicUrl)
      } else {
        alert('圖片上傳失敗')
      }
    } catch (error) {
      console.error(error)
      alert('圖片上傳發生錯誤')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async () => {
    if (!imageUrl || !confirm('確定要刪除這張圖片嗎？')) return

    setUploading(true)
    try {
      const success = await deleteBillImage(imageUrl)
      if (success) {
        setImageUrl(null)
        onImageDeleted()
      } else {
        alert('刪除失敗')
      }
    } catch (error) {
      console.error(error)
      alert('刪除發生錯誤')
    } finally {
      setUploading(false)
    }
  }

  // 拖放處理
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    if (!readOnly) setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (readOnly) return

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await handleUpload(e.dataTransfer.files[0])
    }
  }

  return (
    <>
      {/* 遮罩 (點擊可關閉) - 僅在手機版顯示 */}
      <div
        className={`fixed inset-0 bg-black/30 transition-opacity z-[60] sm:hidden ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* 抽屜本體 */}
      <div
        className={`fixed top-0 right-0 h-full w-full bg-white shadow-2xl z-[70] transition-all duration-300 ease-in-out flex flex-col transform ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        } ${
          inline
            ? `sm:sticky sm:top-0 sm:h-[90vh] sm:z-auto sm:transform-none sm:shadow-none sm:border-l sm:border-gray-200 ${
                isOpen ? 'sm:w-[480px] sm:opacity-100' : 'sm:w-0 sm:opacity-0 sm:overflow-hidden'
              }`
            : 'sm:w-[480px]'
        }`}
      >
        {/* 標題列 */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h3 className="text-lg font-bold text-slate-900">發票圖片</h3>
          <button
            onClick={onClose}
            className="p-2 text-slate-500 hover:bg-slate-100 rounded-full transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 內容區 */}
        <div className="flex-1 overflow-y-auto bg-slate-50 p-4">
          {imageUrl ? (
            <div className="space-y-4 flex flex-col h-full">
              <div 
                className="relative rounded-lg overflow-hidden border border-gray-200 shadow-sm bg-gray-100 flex-1 flex items-center justify-center min-h-[300px]"
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
              >
                <div 
                   className="w-full h-full flex items-center justify-center overflow-hidden"
                   onMouseDown={handleMouseDown}
                   style={{ cursor: scale > 1 ? (isDraggingImage ? 'grabbing' : 'grab') : 'default' }}
                >
                    <img
                      src={imageUrl}
                      alt="Bill"
                      className="max-w-full max-h-full object-contain transition-transform duration-75 ease-out origin-center select-none"
                      style={{
                        transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`
                      }}
                      draggable={false}
                    />
                </div>
                
                {/* Zoom Controls */}
                <div className="absolute bottom-4 right-4 flex gap-2 z-10">
                   <button 
                     onClick={handleZoomOut} 
                     className="p-2 bg-white/90 rounded-full shadow-md hover:bg-white text-gray-700 disabled:opacity-50 transition-colors" 
                     disabled={scale <= 1}
                     title="縮小"
                   >
                     <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" /></svg>
                   </button>
                   <span className="py-2 px-3 bg-white/90 rounded-full shadow-md text-sm font-bold tabular-nums min-w-[3.5rem] text-center flex items-center justify-center text-gray-700">
                     {Math.round(scale * 100)}%
                   </span>
                   <button 
                     onClick={handleZoomIn} 
                     className="p-2 bg-white/90 rounded-full shadow-md hover:bg-white text-gray-700 disabled:opacity-50 transition-colors" 
                     disabled={scale >= 5}
                     title="放大"
                   >
                     <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                   </button>
                   {scale > 1 && (
                     <button 
                       onClick={handleResetZoom} 
                       className="p-2 bg-white/90 rounded-full shadow-md hover:bg-white text-gray-700 transition-colors" 
                       title="重置"
                     >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                     </button>
                   )}
                </div>
              </div>
              
              {!readOnly && (
                <div className="flex gap-3">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="flex-1 py-2 px-4 bg-white border border-gray-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
                  >
                    更換圖片
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={uploading}
                    className="flex-1 py-2 px-4 bg-white border border-error-300 rounded-lg text-sm font-medium text-error-700 hover:bg-error-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-error-500 disabled:opacity-50"
                  >
                    刪除圖片
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div
              className={`h-full min-h-[300px] border-2 border-dashed rounded-xl flex flex-col items-center justify-center p-6 text-center transition-colors ${
                isDragging
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-gray-300 hover:border-gray-400 bg-white'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {uploading ? (
                <div className="flex flex-col items-center">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600 mb-3"></div>
                  <p className="text-sm text-slate-600">正在處理圖片...</p>
                </div>
              ) : readOnly ? (
                <p className="text-slate-500">無圖片</p>
              ) : (
                <>
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                    <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <h4 className="text-base font-semibold text-slate-900 mb-1">上傳發票圖片</h4>
                  <p className="text-sm text-slate-500 mb-4">點擊或拖放圖片至此</p>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="py-2 px-6 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors shadow-sm"
                  >
                    選擇圖片
                  </button>
                  <p className="text-xs text-slate-400 mt-4">支援 JPG, PNG, WebP (自動壓縮)</p>
                </>
              )}
            </div>
          )}
          
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept="image/*"
            onChange={handleFileSelect}
          />
        </div>
      </div>
    </>
  )
}

