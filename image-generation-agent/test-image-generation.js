/**
 * 简单的图片生成测试脚本
 * 可以直接测试 Gemini Image API 是否工作
 */

import { GoogleGenAI } from '@google/genai'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 从环境变量获取 API Key
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY
console.log(
  '💡 提示: 在 .env 文件中添加: GOOGLE_API_KEY=your_api_key_here',
  process.env
)

if (!GOOGLE_API_KEY) {
  console.error('❌ 错误: 请设置 GOOGLE_API_KEY 环境变量')
  console.log('💡 提示: 在 .env 文件中添加: GOOGLE_API_KEY=your_api_key_here')

  process.exit(1)
}

const geminiClient = new GoogleGenAI({
  apiKey: GOOGLE_API_KEY
})

async function testImageGeneration() {
  console.log('🎨 开始测试 Google Gemini 图像生成...\n')

  const prompt =
    'a fluffy white Samoyed dog with a happy expression, sitting on green grass in a sunny park, natural lighting, professional pet photography, shallow depth of field, 4k, highly detailed fur texture'

  console.log(`📝 Prompt: ${prompt}\n`)

  try {
    const startTime = Date.now()

    console.log('⏳ 正在生成图片...')

    const response = await geminiClient.models.generateImages({
      model: 'models/gemini-2.5-flash-image',
      prompt: prompt,
      config: {
        numberOfImages: 1,
        aspectRatio: '1:1',
        outputMimeType: 'image/png'
      }
    })

    const generationTime = ((Date.now() - startTime) / 1000).toFixed(2)

    console.log(`✅ 图片生成成功！耗时: ${generationTime}秒\n`)

    // 保存图片
    if (response.generatedImages && response.generatedImages.length > 0) {
      const outputDir = path.join(__dirname, '..', 'output')

      // 确保输出目录存在
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true })
      }

      for (let i = 0; i < response.generatedImages.length; i++) {
        const imageData = response.generatedImages[i].image

        if (imageData && imageData.imageBytes) {
          const timestamp = Date.now()
          const fileName = `test_gemini_${timestamp}_${i + 1}.png`
          const filePath = path.join(outputDir, fileName)

          // 保存文件
          const buffer = Buffer.from(imageData.imageBytes, 'base64')
          fs.writeFileSync(filePath, buffer)

          console.log(`💾 图片已保存: ${filePath}`)
        }
      }

      console.log('\n🎉 测试完成！')
      console.log(`📁 图片保存在: ${outputDir}`)
    } else {
      console.log('⚠️  警告: 未获得图片数据')
    }
  } catch (error) {
    console.error('\n❌ 测试失败:')
    console.error(error.message)

    if (error.message.includes('API key')) {
      console.log('\n💡 提示: 请检查你的 GOOGLE_API_KEY 是否正确')
      console.log('获取地址: https://aistudio.google.com/app/apikey')
    }

    process.exit(1)
  }
}

// 运行测试
testImageGeneration()
