'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Dashboard from '@/components/Dashboard'

export default function Home() {
  const router = useRouter()

  // 允許訪客模式，不強制登入
  // useEffect(() => {
  //   const checkSession = async () => {
  //     const {
  //       data: { session },
  //     } = await supabase.auth.getSession()

  //     if (!session) {
  //       router.push('/auth')
  //     }
  //   }

  //   checkSession()
  // }, [router])

  return <Dashboard />
}

