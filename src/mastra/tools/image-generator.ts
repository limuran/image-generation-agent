import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  GEMINI_IMAGE_SIZES,
  MAX_GEMINI_IMAGES_PER_REQUEST,
  extractGeminiErrorMessage,
  generateGeminiImages,
} from './gemini-image-utils';

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
      .enum(GEMINI_IMAGE_SIZES)
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

    const images: Array<{ url: string; revised_prompt?: string }> = [];
    const targetCount = Math.min(count, MAX_GEMINI_IMAGES_PER_REQUEST);

    try {
      const generatedImages = await generateGeminiImages({
        prompt,
        count: targetCount,
        size,
      });

      for (const image of generatedImages) {
        images.push({
          url: image.dataUrl,
          revised_prompt: image.revisedPrompt,
        });
      }

      return {
        images,
        total_count: images.length,
      };
    } catch (error) {
      const message = extractGeminiErrorMessage(error);
      console.error('图像生成失败:', message);
      throw new Error(`图像生成失败: ${message}`);
    }
  },
});

export default imageGeneratorTool;
