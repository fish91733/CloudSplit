# CloudSplit 雲端多人分帳系統

一個響應式網頁應用，用於記錄發票明細並自動計算多人分擔金額。

## 技術棧

- **Frontend**: Next.js 14 (App Router) + React + TypeScript
- **Styling**: Tailwind CSS
- **Backend/Database**: Supabase (Authentication + PostgreSQL)
- **日期處理**: date-fns

## 功能特色

- ✅ 用戶認證系統（登入/註冊）
- ✅ 發票/專案管理
- ✅ 動態參與者管理
- ✅ 品項明細輸入（支援折扣比與折扣調整）
- ✅ 自動計算分擔金額：`(單價 / 分擔人數) * 折扣比 + 折扣調整`
- ✅ 即時結算總計（顯示每位參與者應付金額）
- ✅ 歷史紀錄列表
- ✅ 響應式設計（支援手機與電腦瀏覽）

## 設置步驟

### 1. 安裝依賴

```bash
npm install
```

### 2. 設置 Supabase

1. 前往 [Supabase](https://supabase.com) 建立新專案
2. 在 Supabase Dashboard 的 SQL Editor 中執行 `supabase_schema.sql` 來建立資料表與 RLS 政策
3. 在 Supabase Dashboard 的 Authentication 設定中啟用 Email 註冊功能

### 3. 設置環境變數

在專案根目錄建立 `.env.local` 檔案：

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

您可以在 Supabase Dashboard 的 Settings > API 中找到這些值。

### 4. 啟動開發伺服器

```bash
npm run dev
```

開啟瀏覽器前往 [http://localhost:3000](http://localhost:3000)

## 專案結構

```
CloudSplit/
├── app/                    # Next.js App Router 頁面
│   ├── auth/              # 認證頁面
│   ├── bills/             # 發票相關頁面
│   │   ├── new/           # 新增發票
│   │   └── [id]/          # 編輯發票
│   ├── globals.css        # 全域樣式
│   ├── layout.tsx         # 根佈局
│   └── page.tsx           # 首頁 (Dashboard)
├── components/            # React 組件
│   ├── Dashboard.tsx      # 主頁面（歷史紀錄列表）
│   └── BillEditor.tsx     # 發票編輯器（建立/編輯）
├── lib/                   # 工具函數
│   ├── supabase.ts        # Supabase 客戶端（客戶端組件用）
│   └── supabase-server.ts # Supabase 客戶端（伺服器組件用）
├── utils/                 # 工具函數
│   └── calculations.ts    # 計算邏輯
└── supabase_schema.sql    # 資料庫架構 SQL
```

## 資料庫結構

- `profiles` - 使用者資料
- `bills` - 發票/專案
- `bill_participants` - 參與者
- `bill_items` - 品項明細
- `split_details` - 分擔明細

所有資料表均已設置 Row Level Security (RLS)，確保使用者只能存取自己的資料。

## 使用說明

1. **註冊/登入**：首次使用請先註冊帳號
2. **建立發票**：點擊「新增發票」按鈕
3. **設定參與者**：輸入參與者名稱（例如：F, B, C, M...）
4. **新增品項**：輸入品項名稱、單價、選擇分擔人、設定折扣比與折扣調整
5. **查看結算**：頁面底部會即時顯示每位參與者的應付總額
6. **儲存**：點擊「儲存」按鈕將資料儲存至 Supabase
7. **查看歷史**：返回主頁面查看所有歷史紀錄

## 計算公式

每人分擔金額 = `(單價 / 分擔人數) × 折扣比 + 折扣調整金額`

範例：
- 單價：$100
- 分擔人數：2 人
- 折扣比：0.9
- 折扣調整：$5

每人分擔金額 = (100 / 2) × 0.9 + 5 = 45 + 5 = $50

## 建置與部署

### 建置

```bash
npm run build
```

建置完成後，靜態檔案會輸出到 `out` 資料夾。

### 啟動生產環境

```bash
npm start
```

### 部署選項

#### GitHub Pages（已配置）

專案已配置為支援 GitHub Pages 部署。詳細步驟請參考 [DEPLOY.md](./DEPLOY.md)。

**快速部署：**
1. 推送程式碼到 GitHub
2. 在 GitHub 設定 Secrets（Supabase URL 和 Key）
3. 啟用 GitHub Pages（使用 GitHub Actions）
4. 自動部署完成！

#### 其他部署平台

也可部署至：
- [Vercel](https://vercel.com)（推薦，與 Next.js 完美整合）
- [Netlify](https://netlify.com)
- 任何支援靜態網站的平台

## 授權

MIT License

