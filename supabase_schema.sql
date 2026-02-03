-- ============================================
-- CloudSplit 雲端多人分帳系統 - Supabase 資料庫架構
-- ============================================

-- 啟用必要的擴展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- 1. Profiles 表（使用者資料）
-- ============================================
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    full_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 2. Bills 表（發票/專案）
-- ============================================
CREATE TABLE IF NOT EXISTS public.bills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    description TEXT,
    bill_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    total_amount NUMERIC(10, 2) DEFAULT 0,
    checked BOOLEAN DEFAULT false NOT NULL,
    payer TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 3. Bill Participants 表（參與者）
-- ============================================
CREATE TABLE IF NOT EXISTS public.bill_participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bill_id UUID NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(bill_id, name)
);

-- ============================================
-- 4. Bill Items 表（品項明細）
-- ============================================
CREATE TABLE IF NOT EXISTS public.bill_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bill_id UUID NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
    item_name TEXT NOT NULL,
    unit_price NUMERIC(10, 2) NOT NULL,
    discount_ratio NUMERIC(5, 2) DEFAULT 1.0,
    discount_adjustment NUMERIC(10, 2) DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 5. Split Details 表（分擔明細）
-- ============================================
CREATE TABLE IF NOT EXISTS public.split_details (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bill_item_id UUID NOT NULL REFERENCES public.bill_items(id) ON DELETE CASCADE,
    participant_id UUID NOT NULL REFERENCES public.bill_participants(id) ON DELETE CASCADE,
    share_amount NUMERIC(10, 2) NOT NULL,
    paid_amount NUMERIC(10, 2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(bill_item_id, participant_id)
);

-- ============================================
-- 6. Participant Payments 表（實付記錄）
-- ============================================
CREATE TABLE IF NOT EXISTS public.participant_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    participant_name TEXT UNIQUE NOT NULL,
    paid_amount NUMERIC(12, 2) DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 索引建立
-- ============================================
CREATE INDEX IF NOT EXISTS idx_bills_created_by ON public.bills(created_by);
CREATE INDEX IF NOT EXISTS idx_bills_bill_date ON public.bills(bill_date);
CREATE INDEX IF NOT EXISTS idx_bills_checked ON public.bills(checked);
CREATE INDEX IF NOT EXISTS idx_bill_participants_bill_id ON public.bill_participants(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_items_bill_id ON public.bill_items(bill_id);
CREATE INDEX IF NOT EXISTS idx_split_details_bill_item_id ON public.split_details(bill_item_id);
CREATE INDEX IF NOT EXISTS idx_split_details_participant_id ON public.split_details(participant_id);

-- ============================================
-- RLS (Row Level Security) 啟用
-- ============================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.split_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participant_payments ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS Policies - Profiles
-- ============================================
-- 使用者可以讀取自己的 profile
CREATE POLICY "Users can view own profile"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id);

-- 使用者可以更新自己的 profile
CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id);

-- 使用者可以在註冊時插入自己的 profile
CREATE POLICY "Users can insert own profile"
    ON public.profiles FOR INSERT
    WITH CHECK (auth.uid() = id);

-- ============================================
-- RLS Policies - Bills
-- ============================================
-- 允許所有人（包括訪客）查看所有 bills（訪客模式支援）
CREATE POLICY "Anyone can view all bills"
    ON public.bills FOR SELECT
    USING (true);

-- 使用者可以建立新的 bills
CREATE POLICY "Users can create own bills"
    ON public.bills FOR INSERT
    WITH CHECK (auth.uid() = created_by);

-- 使用者可以更新自己建立的 bills
CREATE POLICY "Users can update own bills"
    ON public.bills FOR UPDATE
    USING (auth.uid() = created_by);

-- 使用者可以刪除自己建立的 bills
CREATE POLICY "Users can delete own bills"
    ON public.bills FOR DELETE
    USING (auth.uid() = created_by);

-- ============================================
-- RLS Policies - Bill Participants
-- ============================================
-- 允許所有人（包括訪客）查看所有參與者（訪客模式支援）
CREATE POLICY "Anyone can view all participants"
    ON public.bill_participants FOR SELECT
    USING (true);

-- 使用者可以新增自己 bills 的參與者
CREATE POLICY "Users can insert participants to own bills"
    ON public.bill_participants FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.bills
            WHERE bills.id = bill_participants.bill_id
            AND bills.created_by = auth.uid()
        )
    );

-- 使用者可以更新自己 bills 的參與者
CREATE POLICY "Users can update participants of own bills"
    ON public.bill_participants FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.bills
            WHERE bills.id = bill_participants.bill_id
            AND bills.created_by = auth.uid()
        )
    );

-- 使用者可以刪除自己 bills 的參與者
CREATE POLICY "Users can delete participants of own bills"
    ON public.bill_participants FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.bills
            WHERE bills.id = bill_participants.bill_id
            AND bills.created_by = auth.uid()
        )
    );

-- ============================================
-- RLS Policies - Bill Items
-- ============================================
-- 允許所有人（包括訪客）查看所有品項（訪客模式支援）
CREATE POLICY "Anyone can view all items"
    ON public.bill_items FOR SELECT
    USING (true);

-- 使用者可以新增自己 bills 的品項
CREATE POLICY "Users can insert items to own bills"
    ON public.bill_items FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.bills
            WHERE bills.id = bill_items.bill_id
            AND bills.created_by = auth.uid()
        )
    );

-- 使用者可以更新自己 bills 的品項
CREATE POLICY "Users can update items of own bills"
    ON public.bill_items FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.bills
            WHERE bills.id = bill_items.bill_id
            AND bills.created_by = auth.uid()
        )
    );

-- 使用者可以刪除自己 bills 的品項
CREATE POLICY "Users can delete items of own bills"
    ON public.bill_items FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.bills
            WHERE bills.id = bill_items.bill_id
            AND bills.created_by = auth.uid()
        )
    );

-- ============================================
-- RLS Policies - Split Details
-- ============================================
-- 允許所有人（包括訪客）查看所有分擔明細（訪客模式支援）
CREATE POLICY "Anyone can view all split details"
    ON public.split_details FOR SELECT
    USING (true);

-- 使用者可以新增自己 bills 的分擔明細
CREATE POLICY "Users can insert split details to own bills"
    ON public.split_details FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.bill_items
            JOIN public.bills ON bills.id = bill_items.bill_id
            WHERE bill_items.id = split_details.bill_item_id
            AND bills.created_by = auth.uid()
        )
    );

-- 使用者可以更新自己 bills 的分擔明細
CREATE POLICY "Users can update split details of own bills"
    ON public.split_details FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.bill_items
            JOIN public.bills ON bills.id = bill_items.bill_id
            WHERE bill_items.id = split_details.bill_item_id
            AND bills.created_by = auth.uid()
        )
    );

-- 使用者可以刪除自己 bills 的分擔明細
CREATE POLICY "Users can delete split details of own bills"
    ON public.split_details FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.bill_items
            JOIN public.bills ON bills.id = bill_items.bill_id
            WHERE bill_items.id = split_details.bill_item_id
            AND bills.created_by = auth.uid()
        )
    );

CREATE POLICY "Anyone can view participant payments"
    ON public.participant_payments FOR SELECT
    USING (true);

CREATE POLICY "Authenticated users manage participant payments"
    ON public.participant_payments FOR ALL
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================
-- Trigger: 自動更新 updated_at 時間戳
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bills_updated_at BEFORE UPDATE ON public.bills
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bill_items_updated_at BEFORE UPDATE ON public.bill_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Function: 自動建立 profile 當用戶註冊時
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', '')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: 當新用戶註冊時自動建立 profile
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- 完成！
-- ============================================
-- 執行此 SQL 後，資料庫架構即建立完成
-- 請記得在 Supabase Dashboard 的 Authentication 設定中啟用註冊功能
