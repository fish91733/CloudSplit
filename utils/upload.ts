import imageCompression from 'browser-image-compression'
import { supabase } from '@/lib/supabase'

export async function compressImage(file: File): Promise<File> {
  const options = {
    maxSizeMB: 0.5, // 限制最大 0.5MB (500KB)
    maxWidthOrHeight: 1280, // 限制最大寬或高 1280px
    useWebWorker: true,
    fileType: 'image/webp', // 轉為 WebP 格式
  }

  try {
    const compressedFile = await imageCompression(file, options)
    return compressedFile
  } catch (error) {
    console.error('Error compressing image:', error)
    throw error
  }
}

export async function uploadBillImage(file: File, billId: string): Promise<string | null> {
  try {
    // 1. 壓縮圖片
    const compressedFile = await compressImage(file)

    // 2. 產生檔案路徑: bill_id/timestamp.webp
    // 使用 billId 作為資料夾，避免檔名衝突，也方便管理
    const timestamp = new Date().getTime()
    const filePath = `${billId}/${timestamp}.webp`

    // 3. 上傳到 Supabase Storage
    const { data, error } = await supabase.storage
      .from('bill-images')
      .upload(filePath, compressedFile, {
        cacheControl: '3600',
        upsert: false,
      })

    if (error) {
      throw error
    }

    // 4. 取得公開 URL
    const { data: { publicUrl } } = supabase.storage
      .from('bill-images')
      .getPublicUrl(filePath)

    return publicUrl
  } catch (error) {
    console.error('Error uploading image:', error)
    return null
  }
}

export async function deleteBillImage(pathOrUrl: string): Promise<boolean> {
  try {
    // 從 URL 中提取路徑
    // 假設 URL 格式: .../storage/v1/object/public/bill-images/BILL_ID/FILENAME.webp
    const bucketPath = 'bill-images/'
    let path = pathOrUrl
    
    if (pathOrUrl.includes(bucketPath)) {
      path = pathOrUrl.split(bucketPath)[1]
    }

    const { error } = await supabase.storage
      .from('bill-images')
      .remove([path])

    if (error) {
      throw error
    }

    return true
  } catch (error) {
    console.error('Error deleting image:', error)
    return false
  }
}

