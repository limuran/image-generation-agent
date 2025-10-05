import { registerApiRoute } from '@mastra/core/server';
import { uploadMultipleImages } from '../utils/r2-storage';
import type { GenerateImageRequest, GenerateImageResponse } from '../types';

/**
 * 健康检查路由
 */
const healthRoute = registerApiRoute('/health', {
  method: 'GET',
  handler: async (c) => {
    return c.json({
      status: 'ok',
      service: 'image-generation-agent',
      timestamp: new Date().toISOString(),
    });
  },
});

/**
 * 图像生成路由
 */
const generateImageRoute = registerApiRoute('/generate-image', {
  method: 'POST',
  handler: async (c) => {
    const startTime = Date.now();
    
    let task_id: string | undefined;
    let prompt: string | undefined;
    let count = 1;
    
    try {
      const body = await c.req.json<GenerateImageRequest>();
      
      task_id = body.task_id;
      prompt = body.prompt;
      count = body.count ?? 1;
      
      // 验证必需参数
      if (!task_id || !prompt) {
        return c.json<GenerateImageResponse>({
          success: false,
          task_id: task_id || 'unknown',
          generation_time: 0,
          error: {
            code: 'MISSING_PARAMETERS',
            message: 'task_id和prompt是必需的参数',
          },
        }, 400);
      }
      
      // 验证count范围
      if (count < 1 || count > 5) {
        return c.json<GenerateImageResponse>({
          success: false,
          task_id,
          generation_time: 0,
          error: {
            code: 'INVALID_COUNT',
            message: 'count必须在1-5之间',
          },
        }, 400);
      }
      
      console.log(`📥 收到任务: ${task_id}, prompt: "${prompt}", count: ${count}`);
      
      // TODO: 调用Mastra Agent生成图片
      // const mastra = c.get('mastra');
      // const agent = await mastra.getAgent('imageGenerationAgent');
      // const result = await agent.generate(`生成${count}张图片：${prompt}`);
      
      // 临时模拟数据
      const generatedImages = Array.from({ length: count }, (_, i) => ({
        url: `https://example.com/temp-${task_id}-${i + 1}.png`,
      }));
      
      console.log(`🎨 图片生成完成，开始上传到R2...`);
      
      // 上传到R2（如果在Workers环境中）
      // const r2Bucket = c.env.IMAGE_STORAGE;
      // const uploadResults = await uploadMultipleImages(
      //   r2Bucket,
      //   task_id,
      //   generatedImages
      // );
      
      // 临时返回模拟结果
      const images = generatedImages.map((img, index) => ({
        index: index + 1,
        url: img.url,
        storage_key: `images/temp-${task_id}-${index + 1}.png`,
      }));
      
      const totalTime = (Date.now() - startTime) / 1000;
      
      console.log(`✅ 任务完成: ${task_id}, 耗时: ${totalTime.toFixed(2)}s`);
      
      return c.json<GenerateImageResponse>({
        success: true,
        task_id,
        total_images: images.length,
        images: images,
        generation_time: totalTime,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        metadata: {
          prompt,
          requested_count: count,
          actual_count: images.length,
        },
      });
      
    } catch (error: any) {
      console.error('❌ 处理失败:', error);
      const totalTime = (Date.now() - startTime) / 1000;
      
      return c.json<GenerateImageResponse>({
        success: false,
        task_id: task_id || 'unknown',
        generation_time: totalTime,
        error: {
          code: 'GENERATION_FAILED',
          message: error.message || '图像生成失败',
        },
      }, 500);
    }
  },
});

/**
 * 批量生成路由（占位）
 */
const generateBatchRoute = registerApiRoute('/generate-batch', {
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

// 导出路由数组
export const routes = [
  healthRoute,
  generateImageRoute,
  generateBatchRoute,
];

export default { routes };