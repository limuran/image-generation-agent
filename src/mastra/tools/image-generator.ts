import { createTool } from '@mastra/core/tools';
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';

const GOOGLE_GEMINI_IMAGE_MODEL = 'models/gemini-2.5-flash-image';
const MAX_IMAGES_PER_REQUEST = 4;

const googleApiKey =
  process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GOOGLE_VERTEX_API_KEY || '';

const geminiImageClient = new GoogleGenAI({
  apiKey: googleApiKey || undefined,
});

const aspectRatioMap: Record<'1024x1024' | '1024x1792' | '1792x1024', string> = {
  '1024x1024': '1:1',
  '1024x1792': '9:16',
  '1792x1024': '16:9',
};

export const imageGeneratorTool = createTool({
  id: 'generate-images',
  description: '使用 Google Gemini 2.5 Flash Image 生成1-4张高质量图像，返回 base64 数据 URL',

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
      .describe('图片尺寸，将映射为Google Gemini支持的宽高比'),
    quality: z
      .enum(['standard', 'hd'])
      .default('standard')
      .describe('图片质量（Google Gemini图像API当前不支持此选项，将被忽略）'),
  }),

  outputSchema: z.object({
    images: z.array(
      z.object({
        url: z.string().describe('图片的base64数据URL'),
        revised_prompt: z.string().optional().describe('Gemini修订后的prompt'),
      }),
    ),
    total_count: z.number(),
  }),

  execute: async ({ context }) => {
    const { prompt, count, size } = context;

    if (!googleApiKey) {
      throw new Error('图像生成失败: 未配置 Google Gemini API Key (GOOGLE_API_KEY 或 GOOGLE_GENAI_API_KEY)');
    }

    const images: Array<{ url: string; revised_prompt?: string }> = [];
    const targetCount = Math.min(count, MAX_IMAGES_PER_REQUEST);
    const aspectRatio = aspectRatioMap[size];

    try {
      const response = await geminiImageClient.models.generateImages({
        model: GOOGLE_GEMINI_IMAGE_MODEL,
        prompt,
        config: {
          numberOfImages: targetCount,
          aspectRatio,
          outputMimeType: 'image/png',
        },
      });

      for (const generatedImage of response.generatedImages ?? []) {
        const imagePayload = generatedImage.image;
        if (!imagePayload?.imageBytes) {
          continue;
        }

        const mimeType = imagePayload.mimeType || 'image/png';
        images.push({
          url: `data:${mimeType};base64,${imagePayload.imageBytes}`,
        });
      }

      if (images.length === 0) {
        throw new Error('未从Google Gemini图像模型获得任何图像');
      }

      return {
        images,
        total_count: images.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('图像生成失败:', message);
      throw new Error(`图像生成失败: ${message}`);
    }
  },
});

export default imageGeneratorTool;
