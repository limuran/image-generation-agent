import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { GoogleGenAI, Modality } from '@google/genai'

const GOOGLE_GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image'
const MAX_IMAGES_PER_REQUEST = 4

const googleApiKey = process.env.GOOGLE_API_KEY
const geminiImageClient = new GoogleGenAI({
  apiKey: googleApiKey || undefined
})

const aspectRatioMap: Record<'1024x1024' | '1024x1792' | '1792x1024', string> =
  {
    '1024x1024': '1:1',
    '1024x1792': '9:16',
    '1792x1024': '16:9'
  }

export const imageGeneratorTool = createTool({
  id: 'generate-images',
  description: '使用 Google Imagen 4 生成1-4张高质量图像，返回 base64 数据 URL',

  inputSchema: z.object({
    prompt: z.string().describe('优化后的图像生成prompt，应该详细且专业'),
    count: z
      .number()
      .min(1)
      .max(5)
      .default(1)
      .describe('要生成的图片数量，单次最多4张，多余部分请分批调用'),
    size: z
      .enum(['1024x1024', '1024x1792', '1792x1024'])
      .default('1024x1024')
      .describe('图片尺寸，将映射为Google Imagen支持的宽高比'),
    quality: z
      .enum(['standard', 'hd'])
      .default('standard')
      .describe('图片质量（Google Imagen当前不支持此选项，将被忽略）')
  }),

  outputSchema: z.object({
    images: z.array(
      z.object({
        url: z.string().describe('图片的base64数据URL'),
        revised_prompt: z.string().optional().describe('Imagen修订后的prompt')
      })
    ),
    total_count: z.number()
  }),

  execute: async ({ context }) => {
    const { prompt, count, size } = context

    if (!googleApiKey) {
      throw new Error(
        '图像生成失败: 未配置 Google Imagen API Key (GOOGLE_API_KEY )'
      )
    }

    const images: Array<{ url: string; revised_prompt?: string }> = []
    const targetCount = Math.min(count, MAX_IMAGES_PER_REQUEST)
    const aspectRatio = aspectRatioMap[size]
    try {
      for (let i = 0; i < targetCount; i++) {
        const response = await geminiImageClient.models.generateContent({
          model: GOOGLE_GEMINI_IMAGE_MODEL,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `${prompt}\n\n请使用 ${aspectRatio} 的构图比例 (尺寸 ${size})`
                }
              ]
            }
          ],
          config: {
            candidateCount: 1,
            responseMimeType: 'image/png',
            responseModalities: [Modality.IMAGE]
          }
        })

        const candidates = response.candidates ?? []
        let addedImage = false

        for (const candidate of candidates) {
          const parts = candidate.content?.parts ?? []

          for (const part of parts) {
            const inlineData = part.inlineData
            if (!inlineData?.data) {
              continue
            }

            const mimeType = inlineData.mimeType || 'image/png'
            images.push({
              url: `data:${mimeType};base64,${inlineData.data}`
            })
            addedImage = true

            if (images.length >= targetCount) {
              break
            }
          }

          if (images.length >= targetCount) {
            break
          }
        }

        if (!addedImage && typeof response.data === 'string') {
          images.push({
            url: `data:image/png;base64,${response.data}`
          })
        }

        if (images.length >= targetCount) {
          break
        }
      }

      if (images.length === 0) {
        throw new Error('未从Google Gemini图像模型获得任何图像')
      }

      return {
        images,
        total_count: images.length
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('图像生成失败:', message)
      throw new Error(`图像生成失败: ${message}`)
    }
  }
})

export default imageGeneratorTool
