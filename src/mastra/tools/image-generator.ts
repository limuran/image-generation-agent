import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import OpenAI from 'openai';

// OpenAI客户端用于DALL-E 3
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

// 定义图像生成工具
export const imageGeneratorTool = createTool({
  id: 'generate-images',
  description: '根据prompt生成高质量图像，支持生成1-5张图片',
  
  inputSchema: z.object({
    prompt: z.string().describe('优化后的图像生成prompt，应该详细且专业'),
    count: z.number().min(1).max(5).default(1).describe('要生成的图片数量，1-5张'),
    size: z.enum(['1024x1024', '1024x1792', '1792x1024']).default('1024x1024').describe('图片尺寸'),
    quality: z.enum(['standard', 'hd']).default('standard').describe('图片质量'),
  }),
  
  outputSchema: z.object({
    images: z.array(z.object({
      url: z.string().describe('图片的临时URL'),
      revised_prompt: z.string().optional().describe('DALL-E修订后的prompt'),
    })),
    total_count: z.number(),
  }),
  
  execute: async ({ context }) => {
    const { prompt, count, size, quality } = context;
    const images: Array<{ url: string; revised_prompt?: string }> = [];
    
    try {
      // 生成多张图片
      for (let i = 0; i < count; i++) {
        const response = await openai.images.generate({
          model: 'dall-e-3',
          prompt: prompt,
          n: 1, // DALL-E 3每次只能生成1张
          size: size,
          quality: quality,
        });
        
        if (response.data && response.data[0]) {
          images.push({
            url: response.data[0].url || '',
            revised_prompt: response.data[0].revised_prompt,
          });
        }
      }
      
      return {
        images,
        total_count: images.length,
      };
    } catch (error: any) {
      console.error('图像生成失败:', error);
      throw new Error(`图像生成失败: ${error.message}`);
    }
  },
});

export default imageGeneratorTool;