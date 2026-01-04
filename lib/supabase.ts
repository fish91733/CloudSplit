import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string | null
          full_name: string | null
          avatar_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email?: string | null
          full_name?: string | null
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string | null
          full_name?: string | null
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      bills: {
        Row: {
          id: string
          title: string
          description: string | null
          bill_date: string
          created_by: string
          total_amount: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          title: string
          description?: string | null
          bill_date?: string
          created_by: string
          total_amount?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          title?: string
          description?: string | null
          bill_date?: string
          created_by?: string
          total_amount?: number
          created_at?: string
          updated_at?: string
        }
      }
      bill_participants: {
        Row: {
          id: string
          bill_id: string
          name: string
          created_at: string
        }
        Insert: {
          id?: string
          bill_id: string
          name: string
          created_at?: string
        }
        Update: {
          id?: string
          bill_id?: string
          name?: string
          created_at?: string
        }
      }
      bill_items: {
        Row: {
          id: string
          bill_id: string
          item_name: string
          unit_price: number
          discount_ratio: number
          discount_adjustment: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          bill_id: string
          item_name: string
          unit_price: number
          discount_ratio?: number
          discount_adjustment?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          bill_id?: string
          item_name?: string
          unit_price?: number
          discount_ratio?: number
          discount_adjustment?: number
          created_at?: string
          updated_at?: string
        }
      }
      split_details: {
        Row: {
          id: string
          bill_item_id: string
          participant_id: string
          share_amount: number
          created_at: string
        }
        Insert: {
          id?: string
          bill_item_id: string
          participant_id: string
          share_amount: number
          created_at?: string
        }
        Update: {
          id?: string
          bill_item_id?: string
          participant_id?: string
          share_amount?: number
          created_at?: string
        }
      }
      participant_payments: {
        Row: {
          id: string
          participant_name: string
          paid_amount: number
          updated_at: string
        }
        Insert: {
          id?: string
          participant_name: string
          paid_amount?: number
          updated_at?: string
        }
        Update: {
          id?: string
          participant_name?: string
          paid_amount?: number
          updated_at?: string
        }
      }
    }
  }
}
