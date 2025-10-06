import { Hono } from 'hono';
import { uploadMultipleImages } from '../utils/r2-storage';
import {
  GEMINI_IMAGE_MODEL_ID,
  GEMINI_IMAGE_SIZES,
  MAX_GEMINI_IMAGES_PER_REQUEST,
  GeminiImageSize,
  generateGeminiImages,
} from '../mastra/tools/gemini-image-utils';

// 创建Hono应用
const app = new Hono<{
  Bindings: {
    IMAGE_STORAGE: R2Bucket;
    MOONSHOT_API_KEY: string;
    OPENAI_API_KEY: string;
    STABILITY_API_KEY?: string;
  };
}>();

/**
 * 健康检查
 */
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'image-generation-agent',
    timestamp: new Date().toISOString(),
  });
});

/**
 * 图像生成API
 * POST /api/generate-image
 */
type GenerateImageOptions = {
  size?: GeminiImageSize | string;
  quality?: 'standard' | 'hd';
  [key: string]: unknown;
};

type GenerateImageRequest = {
  task_id?: string;
  prompt?: string;
  count?: number;
  options?: GenerateImageOptions;
};

const DEFAULT_IMAGE_SIZE: GeminiImageSize = '1024x1024';

const isValidGeminiSize = (value: unknown): value is GeminiImageSize =>
  typeof value === 'string' && (GEMINI_IMAGE_SIZES as ReadonlyArray<string>).includes(value);

app.post('/api/generate-image', async (c) => {
  const startTime = Date.now();
  let requestBody: GenerateImageRequest | undefined;

  try {
    // 解析请求
    const body = await c.req.json<GenerateImageRequest>();
    requestBody = body;
    const { task_id, prompt, count = 1, options = {} } = body;
    
    // 验证必需参数
    if (!task_id || !prompt) {
      return c.json({
        success: false,
        error: {
          code: 'MISSING_PARAMETERS',
          message: 'task_id和prompt是必需的参数',
        },
      }, 400);
    }
    
    // 验证count范围
    if (count < 1 || count > 5) {
      return c.json({
        success: false,
        error: {
          code: 'INVALID_COUNT',
          message: 'count必须在1-5之间',
        },
      }, 400);
    }
    
    const { size: requestedSize } = options;
    if (requestedSize !== undefined && !isValidGeminiSize(requestedSize)) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_SIZE',
            message: `size必须为${GEMINI_IMAGE_SIZES.join(', ')}之一`,
          },
        },
        400,
      );
    }

    const targetSize: GeminiImageSize = isValidGeminiSize(requestedSize) ? requestedSize : DEFAULT_IMAGE_SIZE;

    console.log(
      `📥 收到任务: ${task_id}, prompt: "${prompt}", count: ${count}, size: ${targetSize}, model: ${GEMINI_IMAGE_MODEL_ID}`,
    );

    const requestedQuality = options.quality === 'hd' ? 'hd' : 'standard';

    const totalImagesToGenerate = count;
    const generatedImages: Array<{ base64: string; model_used: string; revised_prompt?: string }> = [];

    while (generatedImages.length < totalImagesToGenerate) {
      const remaining = totalImagesToGenerate - generatedImages.length;
      const batchCount = Math.min(remaining, MAX_GEMINI_IMAGES_PER_REQUEST);
      const batchImages = await generateGeminiImages({
        prompt,
        count: batchCount,
        size: targetSize,
      });

      generatedImages.push(
        ...batchImages.map(image => ({
          base64: image.dataUrl,
          model_used: GEMINI_IMAGE_MODEL_ID,
          revised_prompt: image.revisedPrompt,
        })),
      );
    }

    console.log(`🎨 图片生成完成，共生成 ${generatedImages.length} 张，开始上传到R2...`);

    const r2Bucket = c.env.IMAGE_STORAGE;
    const uploadResults = await uploadMultipleImages(
      r2Bucket,
      task_id,
      generatedImages.map(image => ({ base64: image.base64 })),
    );
    
    // 检查上传结果
    const successfulUploads = uploadResults.filter(r => r.success);
    if (successfulUploads.length === 0) {
      throw new Error('所有图片上传失败');
    }

    // 构建响应
    const images = uploadResults
      .map((upload, index) => ({ upload, index }))
      .filter(item => item.upload.success)
      .map(({ upload, index }, visibleIndex) => ({
        index: visibleIndex + 1,
        url: upload.url,
        storage_key: upload.key,
        model_used: GEMINI_IMAGE_MODEL_ID,
        revised_prompt: generatedImages[index]?.revised_prompt,
      }));

    const totalTime = (Date.now() - startTime) / 1000;

    console.log(`✅ 任务完成: ${task_id}, 耗时: ${totalTime.toFixed(2)}s`);

    return c.json({
      success: true,
      task_id: task_id,
      total_images: images.length,
      images: images,
      generation_time: totalTime,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30天后
      metadata: {
        prompt: prompt,
        requested_count: count,
        actual_count: images.length,
        model_used: GEMINI_IMAGE_MODEL_ID,
        size: targetSize,
        quality: requestedQuality,
        revised_prompts: generatedImages
          .map(image => image.revised_prompt)
          .filter((value): value is string => Boolean(value)),
      },
    });
    
  } catch (error: any) {
    console.error('❌ 处理失败:', error);
    
    const totalTime = (Date.now() - startTime) / 1000;
    
    return c.json({
      success: false,
      task_id: requestBody?.task_id || 'unknown',
      error: {
        code: 'GENERATION_FAILED',
        message: error.message || '图像生成失败',
      },
      generation_time: totalTime,
    }, 500);
  }
});

/**
 * 批量生成API（可选）
 * POST /api/generate-batch
 */
app.post('/api/generate-batch', async (c) => {
  return c.json({
    success: false,
    error: {
      code: 'NOT_IMPLEMENTED',
      message: '批量生成功能即将推出',
    },
  }, 501);
});

export default app;
