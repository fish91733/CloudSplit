'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function AuthPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  // 將用戶名轉換為Email格式（如果沒有@符號，自動添加後綴）
  // 使用 .com 域名確保 Supabase 接受這個格式
  const usernameToEmail = (username: string): string => {
    const trimmed = username.trim().toLowerCase() // 轉為小寫，避免大小寫問題
    if (trimmed.includes('@')) {
      return trimmed
    }
    // 使用標準的 .com 域名格式，Supabase 一定會接受
    return `${trimmed}@cloudsplit.com`
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.push('/')
      }
    })
  }, [router])

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const email = usernameToEmail(username)

      // 只允許登入，不允許註冊
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (error) {
        // 提供更詳細的錯誤訊息
        if (error.message.includes('Invalid login credentials')) {
          throw new Error('帳號或密碼錯誤，請檢查輸入是否正確')
        } else if (error.message.includes('Email not confirmed')) {
          throw new Error('帳號尚未確認，請先在 Supabase Dashboard 中確認帳號，或禁用 Email 確認功能')
        } else {
          throw error
        }
      }
      // 確認登入成功
      if (data.session) {
        router.push('/')
        router.refresh()
      } else {
        throw new Error('登入失敗，請稍後再試')
      }
    } catch (error: any) {
      setError(error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8">
        <h1 className="text-3xl font-bold text-center text-gray-800 mb-2">
          CloudSplit
        </h1>
        <p className="text-center text-gray-600 mb-8">雲端多人分帳系統</p>

        <div className="mb-6">
          <h2 className="text-xl font-semibold text-center text-gray-800">登入</h2>
        </div>

        <form onSubmit={handleAuth} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              帳號
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="輸入帳號（不需要@和域名）"
              required
            />
            <p className="mt-1 text-xs text-gray-500">
              只需輸入帳號名稱即可，系統會自動處理
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              密碼
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              required
              minLength={6}
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary-600 text-white py-3 rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? '處理中...' : '登入'}
          </button>
        </form>

        <div className="mt-6 pt-6 border-t border-gray-200">
          <button
            onClick={() => router.push('/')}
            className="w-full bg-gray-100 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-200 transition-colors"
          >
            以訪客模式瀏覽
          </button>
          <p className="mt-2 text-xs text-center text-gray-500">
            訪客模式可以查看所有發票，但無法新增或編輯
          </p>
        </div>
      </div>
    </div>
  )
}

