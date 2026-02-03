import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'

export async function POST(req: NextRequest) {
    try {
        const { image, fileName } = await req.json()

        if (!image) {
            return NextResponse.json({ error: '未提供圖片資料' }, { status: 400 })
        }

        const apiKey = process.env.GEMINI_API_KEY
        if (!apiKey) {
            return NextResponse.json({ error: '伺服器未設定 GEMINI_API_KEY' }, { status: 500 })
        }

        const genAI = new GoogleGenerativeAI(apiKey)
        // 使用 gemini-flash-latest (經測試可正常運作之模型名稱)
        const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' })

        const prompt = `
      將收據圖片精確轉換為 JSON。檔名為: "${fileName}"。
      
      規則：
      1. **標題 (title)**: 格式為 [流水號] - [店名]。流水號從檔名 "${fileName}" 末尾數字提取。
      2. **日期 (bill_date)**: YYYY-MM-DD。
      3. **品項拆解**: 禁止 Grouping。若數量 > 1，必須拆分成多個 quantity 為 1 的物件。
      4. **人員判讀**: 嚴格區分手寫的「3」與「S」。根據標記位置判斷 participants。
      5. **折扣邏輯 (Adjustment 優先)**:
         - 特定促銷 (如飲料聯促): adjustment 填負值，ratio = 1.0。
         - 全館折扣 (如 9 折): ratio = 0.9，adjustment = 0。
         - 二者不重複計算。
      
      JSON 架構：
      {
        "title": "...",
        "description": "備註折扣情況",
        "bill_date": "YYYY-MM-DD",
        "payer": "付款人名稱",
        "participants": ["參與者1", "參與者2"],
        "items": [
          {
            "item_name": "...",
            "unit_price": 100,
            "quantity": 1,
            "discount_ratio": 1.0,
            "discount_adjustment": 0,
            "participants": ["參與者1"]
          }
        ]
      }
      只需回傳原始 JSON 字串。
    `

        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    data: image,
                    mimeType: 'image/jpeg',
                },
            },
        ])

        const response = await result.response
        let text = response.text().trim()

        // 移除可能的 markdown 標記
        if (text.startsWith('```')) {
            text = text.replace(/^```json\n?/, '').replace(/n?```$/, '').trim()
        }

        try {
            const data = JSON.parse(text)
            return NextResponse.json(data)
        } catch (parseError) {
            console.error('Gemini 回傳格式錯誤:', text)
            return NextResponse.json({ error: '無法解析 AI 回傳的資料', raw: text }, { status: 500 })
        }
    } catch (error: any) {
        console.error('OCR API 錯誤:', error)
        return NextResponse.json({ error: error.message || '內部伺服器錯誤' }, { status: 500 })
    }
}
