import { Hono } from 'hono';
import { uploadMultipleImages } from '../utils/r2-storage';

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
type GenerateImageRequest = {
  task_id?: string;
  prompt?: string;
  count?: number;
  options?: Record<string, unknown>;
};

app.post('/api/generate-image', async (c) => {
  const startTime = Date.now();
  let requestBody: GenerateImageRequest | undefined;

  try {
    // 解析请求
    const body = await c.req.json<GenerateImageRequest>();
    requestBody = body;
    const {
      task_id,
      prompt,
      count = 1,
      options = {},
    } = body;
    
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
    
    console.log(`📥 收到任务: ${task_id}, prompt: "${prompt}", count: ${count}`);
    
    // TODO: 调用Mastra Agent生成图片
    // 这里需要在Workers环境中初始化Mastra
    // const agent = await mastra.getAgent('imageGenerationAgent');
    // const result = await agent.generate(
    //   `请为以下描述生成${count}张高质量图片：${prompt}`
    // );
    
    // 模拟生成结果（实际应该从Agent获取）
    const generatedImages = [
      {
        url: 'https://example.com/temp-image-1.png',
        model_used: 'dall-e-3',
      },
      // ... 更多图片
    ];
    
    console.log(`🎨 图片生成完成，开始上传到R2...`);
    
    // 上传到R2
    const r2Bucket = c.env.IMAGE_STORAGE;
    const uploadResults = await uploadMultipleImages(
      r2Bucket,
      task_id,
      generatedImages.map(img => ({ url: img.url }))
    );
    
    // 检查上传结果
    const successfulUploads = uploadResults.filter(r => r.success);
    if (successfulUploads.length === 0) {
      throw new Error('所有图片上传失败');
    }
    
    // 构建响应
    const images = successfulUploads.map((upload, index) => ({
      index: index + 1,
      url: upload.url,
      storage_key: upload.key,
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
