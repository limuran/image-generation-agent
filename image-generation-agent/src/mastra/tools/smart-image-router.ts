import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import OpenAI from 'openai';

// OpenAI客户端（DALL-E 3）
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

// 定义图像生成工具（仅DALL-E 3）
export const smartImageRouterTool = createTool({
  id: 'smart-image-router',
  description: '使用DALL-E 3生成高质量图像',
  
  inputSchema: z.object({
    optimized_prompt: z.string().describe('已经优化过的高质量prompt'),
    count: z.number().min(1).max(5).default(1).describe('要生成的图片数量'),
    size: z.enum(['1024x1024', '1024x1792', '1792x1024']).default('1024x1024').describe('图片尺寸'),
    quality: z.enum(['standard', 'hd']).default('standard').describe('图片质量'),
  }),
  
  outputSchema: z.object({
    images: z.array(z.object({
      url: z.string().describe('图片URL'),
      revised_prompt: z.string().optional().describe('DALL-E修订后的prompt'),
    })),
    total_count: z.number(),
    generation_time: z.number().describe('生成耗时（秒）'),
  }),
  
  execute: async ({ context }) => {
    const { optimized_prompt, count, size, quality } = context;
    const startTime = Date.now();
    const images: Array<{ url: string; revised_prompt?: string }> = [];
    
    try {
      console.log(`🎨 使用DALL-E 3生成${count}张图片...`);
      
      // 串行生成图片
      for (let i = 0; i < count; i++) {
        const response = await openai.images.generate({
          model: 'dall-e-3',
          prompt: optimized_prompt,
          n: 1,
          size: size,
          quality: quality,
        });
        
        if (response.data && response.data[0]) {
          images.push({
            url: response.data[0].url || '',
            revised_prompt: response.data[0].revised_prompt,
          });
          console.log(`✅ 第 ${i + 1}/${count} 张图片生成完成`);
        }
      }
      
      const generationTime = (Date.now() - startTime) / 1000;
      
      return {
        images,
        total_count: images.length,
        generation_time: generationTime,
      };
    } catch (error: any) {
      console.error('❌ 图像生成失败:', error);
      throw new Error(`图像生成失败: ${error.message}`);
    }
  },
});

export default smartImageRouterTool;