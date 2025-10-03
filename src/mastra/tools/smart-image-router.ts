import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import OpenAI from 'openai';

// OpenAI客户端（DALL-E 3）
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

// Stability AI客户端
const stabilityAI = async (prompt: string, options: any) => {
  const response = await fetch('https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.STABILITY_API_KEY}`,
    },
    body: JSON.stringify({
      text_prompts: [{ text: prompt }],
      cfg_scale: 7,
      height: 1024,
      width: 1024,
      samples: 1,
      steps: 30,
    }),
  });
  
  if (!response.ok) {
    throw new Error(`Stability AI error: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.artifacts[0].base64;
};

// 智能选择最佳模型
const selectBestModel = (prompt: string, requirements: any): string => {
  const promptLower = prompt.toLowerCase();
  
  // 根据关键词智能选择
  if (promptLower.includes('realistic') || promptLower.includes('photo')) {
    return 'dall-e-3'; // 逼真照片用DALL-E 3
  }
  
  if (promptLower.includes('artistic') || promptLower.includes('painting') || promptLower.includes('style')) {
    return 'stable-diffusion'; // 艺术风格用SD
  }
  
  // 默认使用DALL-E 3（速度快，质量稳定）
  return 'dall-e-3';
};

// 定义智能路由图像生成工具
export const smartImageRouterTool = createTool({
  id: 'smart-image-router',
  description: '智能路由到最佳图像生成模型，根据prompt特点自动选择DALL-E 3或Stable Diffusion',
  
  inputSchema: z.object({
    optimized_prompt: z.string().describe('已经优化过的高质量prompt'),
    count: z.number().min(1).max(5).default(1).describe('要生成的图片数量'),
    size: z.enum(['1024x1024', '1024x1792', '1792x1024']).default('1024x1024').describe('图片尺寸'),
    quality: z.enum(['standard', 'hd']).default('standard').describe('图片质量'),
    force_model: z.enum(['dall-e-3', 'stable-diffusion', 'auto']).default('auto').describe('强制使用指定模型或自动选择'),
  }),
  
  outputSchema: z.object({
    images: z.array(z.object({
      url: z.string().describe('图片URL或base64'),
      model_used: z.string().describe('使用的模型'),
      revised_prompt: z.string().optional().describe('模型修订后的prompt'),
    })),
    total_count: z.number(),
    generation_time: z.number().describe('生成耗时（秒）'),
  }),
  
  execute: async ({ context }) => {
    const { optimized_prompt, count, size, quality, force_model } = context;
    const startTime = Date.now();
    const images: Array<{ url: string; model_used: string; revised_prompt?: string }> = [];
    
    try {
      // 选择模型
      const selectedModel = force_model === 'auto' 
        ? selectBestModel(optimized_prompt, { quality })
        : force_model;
      
      console.log(`🎨 使用模型: ${selectedModel}`);
      
      // 串行生成图片
      for (let i = 0; i < count; i++) {
        if (selectedModel === 'dall-e-3') {
          // 使用DALL-E 3
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
              model_used: 'dall-e-3',
              revised_prompt: response.data[0].revised_prompt,
            });
          }
        } else if (selectedModel === 'stable-diffusion') {
          // 使用Stable Diffusion
          const base64Image = await stabilityAI(optimized_prompt, { quality });
          images.push({
            url: `data:image/png;base64,${base64Image}`,
            model_used: 'stable-diffusion-xl',
          });
        }
        
        console.log(`✅ 第 ${i + 1}/${count} 张图片生成完成`);
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