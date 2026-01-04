'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import BillEditor from '@/components/BillEditor'

export default function NewBillPage() {
  const router = useRouter()

  useEffect(() => {
    const checkSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session) {
        router.push('/auth')
      }
    }

    checkSession()
  }, [router])

  return <BillEditor />
}

