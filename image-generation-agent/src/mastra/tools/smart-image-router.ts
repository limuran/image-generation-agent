import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { GoogleGenAI } from '@google/genai';
import { uploadToR2, isR2Configured } from '../../utils/r2-uploader';

const GOOGLE_GEMINI_IMAGE_MODEL = 'models/gemini-2.5-flash-image';
const MAX_IMAGES_PER_REQUEST = 4;

const aspectRatioMap: Record<'1024x1024' | '1024x1792' | '1792x1024', string> = {
  '1024x1024': '1:1',
  '1024x1792': '9:16',
  '1792x1024': '16:9',
};

const resolveAspectRatio = (
  size: '1024x1024' | '1024x1792' | '1792x1024'
): string => aspectRatioMap[size] ?? '1:1';

const resolveGoogleApiKey = (): string | undefined => {
  if (typeof process !== 'undefined' && process.env?.GOOGLE_API_KEY) {
    return process.env.GOOGLE_API_KEY;
  }

  const globalApiKey = (globalThis as unknown as { GOOGLE_API_KEY?: string }).GOOGLE_API_KEY;
  if (typeof globalApiKey === 'string' && globalApiKey.length > 0) {
    return globalApiKey;
  }

  return undefined;
};

const calculateBase64Size = (base64Data: string): number => {
  if (!base64Data) return 0;

  const paddingMatch = base64Data.match(/=+$/);
  const paddingLength = paddingMatch ? paddingMatch[0].length : 0;

  return Math.floor((base64Data.length * 3) / 4) - paddingLength;
};

const extractErrorMessage = (error: unknown): string => {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && 'message' in (error as Record<string, unknown>)) {
    return String((error as Record<string, unknown>).message);
  }
  return String(error);
};

export const smartImageRouterTool = createTool({
  id: 'smart-image-router',
  description:
    '使用 Google Gemini 2.5 Flash Image 生成高质量图像，自动上传到 Cloudflare R2，返回公开 URL',

  inputSchema: z.object({
    optimized_prompt: z.string().describe('已经优化过的高质量prompt'),
    count: z
      .number()
      .min(1)
      .max(5)
      .default(1)
      .describe('要生成的图片数量'),
    size: z
      .enum(['1024x1024', '1024x1792', '1792x1024'])
      .default('1024x1024')
      .describe('图片尺寸'),
    quality: z
      .enum(['standard', 'hd'])
      .default('standard')
      .describe('图片质量'),
    force_model: z
      .enum(['auto', 'google-gemini-image', 'google-imagen'])
      .default('auto')
      .describe('强制使用的模型'),
    task_id: z.string().optional().describe('用于标识任务的 ID'),
  }),

  outputSchema: z.object({
    images: z.array(
      z.object({
        url: z.string().describe('图片的公开 URL（Cloudflare R2 或内嵌 data URL）'),
        r2_key: z.string().optional().describe('R2 存储路径'),
        file_name: z.string().describe('文件名'),
        storage_type: z.enum(['r2', 'inline']).describe('存储类型'),
        model_used: z.string().describe('使用的模型'),
        base64_data: z.string().describe('Base64 编码的图片数据'),
        size_bytes: z.number().optional().describe('图片大小（字节）'),
      }),
    ),
    total_count: z.number(),
    generation_time: z.number().describe('生成耗时（秒）'),
  }),
  
  execute: async ({ context }) => {
    const {
      optimized_prompt,
      count,
      size,
      task_id,
    } = context as {
      optimized_prompt: string;
      count: number;
      size: '1024x1024' | '1024x1792' | '1792x1024';
      task_id?: string;
    };

    const googleApiKey = resolveGoogleApiKey();

    if (!googleApiKey) {
      throw new Error('图像生成失败: 未配置 GOOGLE_API_KEY 环境变量');
    }

    const ai = new GoogleGenAI({ apiKey: googleApiKey });

    const startTime = Date.now();
    const images: Array<{
      url: string;
      r2_key?: string;
      file_name: string;
      storage_type: 'r2' | 'inline';
      model_used: string;
      base64_data: string;
      size_bytes?: number;
    }> = [];
    const targetCount = Math.min(count, MAX_IMAGES_PER_REQUEST);
    const requestedTaskId = typeof task_id === 'string' ? task_id.trim() : '';
    const taskId = requestedTaskId.length > 0 ? requestedTaskId : `task_${Date.now()}`;

    // 检查 R2 是否已配置
    const hasR2 = isR2Configured();
    
    try {
      console.log(`🎨 开始生成图片...`);
      console.log(`📝 Prompt: ${optimized_prompt}`);
      console.log(`🔢 数量: ${targetCount}`);
      console.log(`📐 尺寸: ${size}`);
      console.log(`☁️  R2 状态: ${hasR2 ? '✅ 已配置，将上传到 R2' : '⚠️  未配置，使用本地存储'}`);
      
      const aspectRatio = resolveAspectRatio(size);

      // 根据 count 生成多次
      for (let i = 0; i < targetCount; i++) {
        console.log(`⏳ 正在生成第 ${i + 1}/${targetCount} 张图片...`);

        const response = await ai.models.generateImages({
          model: GOOGLE_GEMINI_IMAGE_MODEL,
          prompt: optimized_prompt,
          config: {
            numberOfImages: 1,
            aspectRatio,
            outputMimeType: 'image/png',
          },
        });

        const generatedImages = response.generatedImages ?? [];

        if (generatedImages.length === 0) {
          console.warn('⚠️  Gemini 响应中没有图片数据，正在重试下一张...');
          continue;
        }

        for (const generatedImage of generatedImages) {
          const payload = generatedImage.image;
          if (!payload?.imageBytes) {
            console.warn('⚠️  跳过空的图片响应片段');
            continue;
          }

          const mimeType = payload.mimeType || 'image/png';
          const imageData = payload.imageBytes;

          const fileName = `gemini_${Date.now()}_${images.length + 1}.png`;
          const inlineUrl = `data:${mimeType};base64,${imageData}`;
          const imageSize = calculateBase64Size(imageData);

          let finalUrl = inlineUrl;
          let storageType: 'r2' | 'inline' = 'inline';
          let r2Key: string | undefined = undefined;
          let sizeBytes = imageSize;

          if (hasR2) {
            console.log(`☁️  正在上传到 Cloudflare R2...`);
            const uploadResult = await uploadToR2(imageData, taskId, images.length + 1);

            if (uploadResult.success) {
              finalUrl = uploadResult.url;
              r2Key = uploadResult.key;
              storageType = 'r2';
              sizeBytes = uploadResult.size ?? imageSize;
              console.log(`✅ R2 上传成功!`);
              console.log(`🔗 公开 URL: ${finalUrl}`);
            } else {
              console.warn(`⚠️  R2 上传失败: ${uploadResult.error}`);
              console.warn(`⚠️  将使用内嵌 data URL`);
            }
          }

          images.push({
            url: finalUrl,
            r2_key: r2Key,
            file_name: fileName,
            storage_type: storageType,
            model_used: GOOGLE_GEMINI_IMAGE_MODEL,
            base64_data: imageData,
            size_bytes: sizeBytes,
          });

          if (images.length >= targetCount) {
            break;
          }
        }

        if (images.length >= targetCount) {
          break;
        }
      }

      if (images.length === 0) {
        throw new Error('未从 Gemini 获得任何图像数据');
      }

      const generationTime = (Date.now() - startTime) / 1000;
      
      console.log(`\n🎉 生成完成！`);
      console.log(`📊 总数: ${images.length} 张`);
      console.log(`⏱️  耗时: ${generationTime.toFixed(2)} 秒`);
      console.log(`💾 存储: ${hasR2 ? 'Cloudflare R2' : '内嵌 data URL'}`);

      // 打印所有图片的 URL
      images.forEach((img, idx) => {
        console.log(`图片 ${idx + 1}:`);
        console.log(`  🔗 URL: ${img.url}`);
        if (img.r2_key) {
          console.log(`  ☁️  R2 Key: ${img.r2_key}`);
        }
        console.log(`  💾 存储类型: ${img.storage_type}\n`);
      });

      return {
        images,
        total_count: images.length,
        generation_time: generationTime,
      };
    } catch (error) {
      const message = extractErrorMessage(error);
      console.error('❌ 图像生成失败:', message);
      
      // 提取更友好的错误信息
      let friendlyError = message;
      let suggestions:string[] = [];
      
      if (message.includes('429') || message.includes('RESOURCE_EXHAUSTED') || message.includes('quota')) {
        friendlyError = 'Google API 配额已用完';
        suggestions = [
          '⏰ 等待配额重置',
          '💳 已启用付费，请等待生效',
          '🔑 使用另一个 API Key'
        ];
      } else if (message.includes('token') && message.includes('exceeds')) {
        friendlyError = '对话历史过长';
        suggestions = ['🔄 刷新页面开始新对话'];
      } else if (message.includes('R2')) {
        friendlyError = `R2 配置错误: ${message}`;
        suggestions = [
          '检查 .env 中的 R2 配置是否完整',
          '确认 R2 API Token 权限正确',
          '验证 R2_BUCKET_NAME 是否存在'
        ];
      }
      
      console.error('\n💡 建议：');
      suggestions.forEach(s => console.error(`   ${s}`));
      
      throw new Error(JSON.stringify({ error: friendlyError, suggestions }));
    }
  },
});

export default smartImageRouterTool;
