import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { GoogleGenAI } from '@google/genai';

const GOOGLE_GEMINI_IMAGE_MODEL = 'models/gemini-2.5-flash-image';
const MAX_IMAGES_PER_REQUEST = 4;

const googleApiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENAI_API_KEY;

const geminiImageClient = new GoogleGenAI({
  apiKey: googleApiKey || undefined,
});


const aspectRatioMap: Record<'1024x1024' | '1024x1792' | '1792x1024', string> = {
  '1024x1024': '1:1',
  '1024x1792': '9:16',
  '1792x1024': '16:9',
};

const extractErrorMessage = (error: unknown): string => {
  if (!error) {
    return '';
  }
  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && 'message' in (error as Record<string, unknown>)) {
    return String((error as Record<string, unknown>).message);
  }

  return String(error);
};
export const smartImageRouterTool = createTool({
  id: 'smart-image-router',
  description:
    '使用 Google Gemini 2.5 Flash Image 自动生成高质量图像，支持根据请求数量批量生成并返回可访问的图片链接',

  inputSchema: z.object({
    optimized_prompt: z.string().describe('已经优化过的高质量prompt'),
       count: z
      .number()
      .min(1)
      .max(5)
      .default(1)
      .describe('要生成的图片数量（最多一次返回4张，其余将通过多次请求生成）'),
    size: z
      .enum(['1024x1024', '1024x1792', '1792x1024'])
      .default('1024x1024')
      .describe('图片尺寸，将映射为Google Gemini支持的宽高比'),
    quality: z
      .enum(['standard', 'hd'])
      .default('standard')
      .describe('图片质量（当前Google Gemini图像API不支持该选项，将被忽略）'),
    force_model: z
      .enum(['auto', 'google-gemini-image', 'google-imagen'])
      .default('auto')
      .describe('保持向后兼容，目前仅支持Google Gemini图像模型'),
  }),
  outputSchema: z.object({
    images: z.array(
      z.object({
        uri: z.string().optional().describe('图片的直接访问链接'),
        base64: z.string().optional().describe('图片的base64数据（用于后续存储或缓存）'),
        mime_type: z
          .string()
          .default('image/png')
          .describe('图片的MIME类型'),
        model_used: z.string().describe('使用的模型'),
        revised_prompt: z.string().optional().describe('模型修订后的prompt'),
      }),
    ),
    total_count: z.number(),
    generation_time: z.number().describe('生成耗时（秒）'),
  }),
  execute: async ({ context }) => {
     const { optimized_prompt, count, size } = context;

    if (!googleApiKey) {
      throw new Error('图像生成失败: 未配置 Google Gemini API Key (GOOGLE_API_KEY 或 GOOGLE_GENAI_API_KEY)');
    }

    const startTime = Date.now();
    const images: Array<{
      uri?: string;
      base64?: string;
      mime_type: string;
      model_used: string;
      revised_prompt?: string;
    }> = [];
     const targetCount = Math.min(count, MAX_IMAGES_PER_REQUEST);
    const aspectRatio = aspectRatioMap[size];
    try {
     const response = await geminiImageClient.models.generateImages({
        model: GOOGLE_GEMINI_IMAGE_MODEL,
        prompt: optimized_prompt,
        config: {
          numberOfImages: targetCount,
          aspectRatio,
          outputMimeType: 'image/png',
        },
      });

      for (const generatedImage of response.generatedImages ?? []) {
        const imagePayload = generatedImage.image;
        if (!imagePayload) {
          continue;
        }

        const mimeType = imagePayload.mimeType || 'image/png';
        const base64 = imagePayload.imageBytes;
        const uri = (imagePayload as { uri?: string; contentUri?: string }).uri ||
          (imagePayload as { uri?: string; contentUri?: string }).contentUri;

        if (!base64 && !uri) {
          continue;
        }

        images.push({
          uri: uri || undefined,
          base64: base64 || undefined,
          mime_type: mimeType,
          model_used: GOOGLE_GEMINI_IMAGE_MODEL,
        });
      }

      if (images.length === 0) {
        throw new Error('未从Google Gemini图像模型获得任何图像');
      }
       const generationTime = (Date.now() - startTime) / 1000;
        return {
          images,
          total_count: images.length,
          generation_time: generationTime,
        };
      } catch (error) {
      const message = extractErrorMessage(error);
      console.error('❌ 图像生成失败:', message);
      throw new Error(`图像生成失败: ${message}`);
    }
  },
});

export default smartImageRouterTool;