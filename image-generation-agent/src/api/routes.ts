import { registerApiRoute } from '@mastra/core/server';
import {
  getImageFromCache,
  saveImageToCache,
} from '../utils/image-cache';
import { smartImageRouterTool } from '../mastra/tools/smart-image-router';
import type {
  GenerateImageRequest,
  GenerateImageResponse,
  GeneratedImage,
} from '../types';

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
      
      const whiteDogKeywords = [/white\s+dog/i, /白色的?狗/, /白狗/];
      const containsWhiteDog = whiteDogKeywords.some((regex) =>
        regex.test(prompt!)
      );

      const enrichedPrompt = containsWhiteDog
        ? prompt
        : `${prompt}, featuring a pure white dog with soft fur and friendly expression`;

      const optimizedPrompt = `Create ${count} ultra detailed, high quality images of a pristine white dog. ${enrichedPrompt}. Photorealistic, 4k resolution, cinematic lighting, professional composition.`;

      console.log(
        `🎨 调用Google Gemini生成图片: task=${task_id}, count=${count}, size=${size}, quality=${quality}`
      );

      const toolResult = await smartImageRouterTool.execute({
        context: {
          optimized_prompt: optimizedPrompt,
          count,
          size,
          quality,
          force_model: 'google-gemini-image',
        },
      });

      const generatedImages: GeneratedImage[] = toolResult.images;

      if (!generatedImages.length) {
        throw new Error('图像生成失败: 未获得任何有效的图片');
      }

      const baseUrl = new URL(c.req.url);
      const origin = `${baseUrl.protocol}//${baseUrl.host}`;

      const images = generatedImages.map((image, index) => {
        const imageIndex = index + 1;
        let publicUrl = image.uri;
        let storageKey = image.uri
          ? `gemini://${image.model_used}/${task_id}/${imageIndex}`
          : `cache://${task_id}/${imageIndex}`;

        const base64Payload = image.base64;
        if (!publicUrl && base64Payload) {
          const normalizedBase64 = base64Payload.startsWith('data:')
            ? base64Payload
            : `data:${image.mime_type};base64,${base64Payload}`;

          saveImageToCache(task_id!, imageIndex, normalizedBase64, image.mime_type);
          publicUrl = `${origin}/images/${task_id}/${imageIndex}`;
        }

        if (!publicUrl) {
          throw new Error('图像生成失败: 无法为生成的图片创建可访问链接');
        }

        return {
          index: imageIndex,
          url: publicUrl,
          storage_key: storageKey,
        };
      });

      const generationTime = toolResult.generation_time ?? (Date.now() - startTime) / 1000;

      console.log(
        `✅ 任务完成: ${task_id}, 成功生成${images.length}张图片, 耗时: ${generationTime.toFixed(
          2
        )}s`
      );

      return c.json<GenerateImageResponse>({
        success: true,
        task_id,
        total_images: images.length,
        images,
        generation_time: generationTime,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        metadata: {
          prompt: optimizedPrompt,
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

const cachedImageRoute = registerApiRoute('/images/:taskId/:imageIndex', {
  method: 'GET',
  handler: async (c) => {
    const { taskId, imageIndex } = c.req.param();

    if (!taskId || !imageIndex) {
      return new Response('Missing parameters', { status: 400 });
    }

    const parsedIndex = Number.parseInt(imageIndex, 10);
    if (Number.isNaN(parsedIndex) || parsedIndex <= 0) {
      return new Response('Invalid image index', { status: 400 });
    }

    const cached = getImageFromCache(taskId, parsedIndex);
    if (!cached) {
      return new Response('Image not found', { status: 404 });
    }

    return new Response(cached.buffer, {
      status: 200,
      headers: {
        'Content-Type': cached.mimeType,
        'Cache-Control': 'public, max-age=300',
      },
    });
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
  cachedImageRoute,
  generateBatchRoute,
];

export default { routes };