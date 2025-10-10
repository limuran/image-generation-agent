import { registerApiRoute } from '@mastra/core/server';
import { uploadMultipleImages, validateR2Config } from '../utils/r2-storage';
import { smartImageRouterTool, GOOGLE_GEMINI_IMAGE_MODEL } from '../mastra/tools/smart-image-router';
import type { GenerateImageRequest, GenerateImageResponse, Env } from '../types';

const calculateBase64Size = (base64Data: string): number => {
  if (!base64Data) return 0;

  const paddingMatch = base64Data.match(/=+$/);
  const paddingLength = paddingMatch ? paddingMatch[0].length : 0;

  return Math.floor((base64Data.length * 3) / 4) - paddingLength;
};

/**
 * 健康检查路由
 */
export const healthRoute = registerApiRoute('/health', {
  method: 'GET',
  handler: async (c) => {
    return c.json({
      status: 'ok',
      service: 'image-generation-agent',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    });
  },
});

/**
 * 图像生成路由
 */
export const generateImageRoute = registerApiRoute('/generate-image', {
  method: 'POST',
  handler: async (c) => {
    const startTime = Date.now();
    
    let task_id: string | undefined;
    let prompt: string | undefined;
    let count = 1;
    let size: '1024x1024' | '1024x1792' | '1792x1024' = '1024x1024';
    let quality: 'standard' | 'hd' = 'standard';
    
    try {
      const body = await c.req.json<GenerateImageRequest>();
      
      task_id = body.task_id;
      prompt = body.prompt;
      count = body.count ?? 1;
      size = body.options?.size ?? '1024x1024';
      quality = body.options?.quality ?? 'standard';
      
      // 验证必需参数
      if (!task_id || !prompt) {
        return c.json<GenerateImageResponse>({
          success: false,
          task_id: task_id || 'unknown',
          generation_time: 0,
          error: {
            code: 'MISSING_PARAMETERS',
            message: 'task_id 和 prompt 是必需的参数',
          },
        }, 400);
      }
      
      // 验证 count 范围
      if (count < 1 || count > 5) {
        return c.json<GenerateImageResponse>({
          success: false,
          task_id,
          generation_time: 0,
          error: {
            code: 'INVALID_COUNT',
            message: 'count 必须在 1-5 之间',
          },
        }, 400);
      }
      
      console.log(`📥 收到任务: ${task_id}`);
      console.log(`📝 Prompt: "${prompt}"`);
      console.log(`🔢 数量: ${count}`);
      console.log(`📐 尺寸: ${size}`);
      
      // 获取环境变量
      const env = c.env as Env;
      const r2Bucket = env.IMAGE_STORAGE;
      const r2PublicUrl = env.R2_PUBLIC_URL;
      
      // 验证 R2 配置
      const r2Validation = validateR2Config(r2Bucket, r2PublicUrl);
      if (!r2Validation.valid) {
        console.warn(`⚠️  R2 配置警告: ${r2Validation.error}`);
        console.warn(`⚠️  将使用本地存储模式`);
      }
      
      // 调用 Gemini 生成图片
      console.log(`🎨 开始生成图片...`);
      const generationResult = await smartImageRouterTool.execute({
        context: {
          optimized_prompt: prompt,
          count: count,
          size: size,
          quality: quality,
          force_model: 'auto',
          task_id,
        },
      } as any); // 使用 any 绕过类型检查
      
      console.log(`✅ 图片生成完成，共 ${generationResult.total_count} 张`);
      
      // 上传到 R2（如果配置了）
      let finalImages;
      
      const generatedImages = generationResult.images ?? [];
      const toolUploadedToR2 =
        generatedImages.length > 0 &&
        generatedImages.every((img: any) => img.storage_type === 'r2');
      const canUploadWithWorker = r2Validation.valid && r2Bucket && r2PublicUrl;

      if (toolUploadedToR2) {
        finalImages = generatedImages.map((img: any, index: number) => ({
          index: index + 1,
          url: img.url,
          storage_key: img.r2_key || '',
          file_name: img.file_name,
          size_bytes: img.size_bytes ?? calculateBase64Size(img.base64_data),
        }));
      } else if (canUploadWithWorker) {
        console.log(`☁️  开始上传到 R2...`);

        const uploadResults = await uploadMultipleImages(
          r2Bucket,
          task_id,
          generatedImages.map((img: any) => ({
            url: `data:image/png;base64,${img.base64_data}`,
          })),
          r2PublicUrl
        );

        if (uploadResults.length > 0) {
          console.log(`✅ R2 上传完成: ${uploadResults.length}/${generationResult.total_count} 张`);
          finalImages = uploadResults;
        } else {
          console.warn(`⚠️  R2 上传全部失败，使用内嵌 data URL`);
          // 使用 data URL 作为备选
          finalImages = generatedImages.map((img: any, index: number) => ({
            index: index + 1,
            url: img.url,
            storage_key: img.r2_key || '',
            file_name: img.file_name,
            size_bytes: calculateBase64Size(img.base64_data),
          }));
        }
      } else {
        // 没有配置 R2，使用 data URL
        console.log(`💾 使用内嵌 data URL 模式`);
        finalImages = generatedImages.map((img: any, index: number) => ({
          index: index + 1,
          url: img.url,
          storage_key: img.r2_key || '',
          file_name: img.file_name,
          size_bytes: calculateBase64Size(img.base64_data),
        }));
      }
      
      const totalTime = (Date.now() - startTime) / 1000;
      
      console.log(`✅ 任务完成: ${task_id}, 耗时: ${totalTime.toFixed(2)}s`);
      console.log(`📊 成功: ${finalImages.length}/${count} 张`);
      
      return c.json<GenerateImageResponse>({
        success: true,
        task_id,
        total_images: finalImages.length,
        images: finalImages,
        generation_time: totalTime,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30天
        metadata: {
          prompt,
          requested_count: count,
          actual_count: finalImages.length,
          model_used:
            generatedImages[0]?.model_used || GOOGLE_GEMINI_IMAGE_MODEL,
        },
      });
      
    } catch (error: any) {
      console.error('❌ 处理失败:', error);
      const totalTime = (Date.now() - startTime) / 1000;
      
      // 提取友好的错误信息
      let errorMessage = error.message || '图像生成失败';
      let errorCode = 'GENERATION_FAILED';
      
      // 解析可能的 JSON 错误
      try {
        const errorData = JSON.parse(error.message);
        if (errorData.error) {
          errorMessage = errorData.error;
          errorCode = 'API_ERROR';
        }
        if (errorData.suggestions) {
          console.log('💡 建议:', errorData.suggestions);
        }
      } catch {
        // 不是 JSON 格式，使用原始错误信息
      }
      
      return c.json<GenerateImageResponse>({
        success: false,
        task_id: task_id || 'unknown',
        generation_time: totalTime,
        error: {
          code: errorCode,
          message: errorMessage,
        },
      }, 500);
    }
  },
});

/**
 * 批量生成路由
 */
export const generateBatchRoute = registerApiRoute('/generate-batch', {
  method: 'POST',
  handler: async (c) => {
    return c.json({
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: '批量生成功能即将推出',
      },
    }, 501);
  },
});

/**
 * 查询任务状态（未来功能）
 */
export const taskStatusRoute = registerApiRoute('/task/:taskId', {
  method: 'GET',
  handler: async (c) => {
    const taskId = c.req.param('taskId');
    
    return c.json({
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: '任务查询功能即将推出',
      },
    }, 501);
  },
});

// 导出所有路由
export const routes = [
  healthRoute,
  generateImageRoute,
  generateBatchRoute,
  taskStatusRoute,
];

export default { routes };