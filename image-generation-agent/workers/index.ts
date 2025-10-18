/**
 * Cloudflare Workers 入口文件
 * 支持异步任务处理和 Webhook 回调
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, ThirdPartyAIRequest, ThirdPartyAIResponse, WebhookCallbackData } from '../src/types';
import { GoogleGenAI } from '@google/genai';
import { uploadMultipleImages, validateR2Config } from '../src/utils/r2-storage';

const app = new Hono<{ Bindings: Env }>();

// 配置 CORS
app.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Length'],
  maxAge: 600,
  credentials: false,
}));

// 健康检查
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'image-generation-agent',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
  });
});

/**
 * 后台执行图片生成并回调 Webhook
 */
async function generateAndCallback(
  task_id: string,
  prompt: string,
  webhook_url: string,
  count: number,
  env: Env
) {
  const startTime = Date.now();
  
  try {
    console.log(`🎨 [${task_id}] 后台任务开始，生成 ${count} 张图片`);
    
    const googleApiKey = env.GOOGLE_API_KEY;
    const r2Bucket = env.IMAGE_STORAGE;
    const r2PublicUrl = env.R2_PUBLIC_URL;
    
    if (!googleApiKey) {
      throw new Error('未配置 GOOGLE_API_KEY');
    }
    
    // 验证 R2 配置
    const r2Validation = validateR2Config(r2Bucket, r2PublicUrl);
    if (!r2Validation.valid) {
      console.warn(`⚠️  [${task_id}] R2 配置警告: ${r2Validation.error}`);
    }
    
    // 初始化 Gemini 客户端
    const ai = new GoogleGenAI({ apiKey: googleApiKey });
    const images: Array<{ url: string }> = [];
    
    // 生成图片
    for (let i = 0; i < Math.min(count, 4); i++) {
      console.log(`⏳ [${task_id}] 正在生成第 ${i + 1}/${count} 张图片...`);
      
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
      });

      // 提取图片数据
      if (response.candidates && response.candidates.length > 0) {
        for (const candidate of response.candidates) {
          if (candidate.content && candidate.content.parts) {
            for (const part of candidate.content.parts) {
              if (part.inlineData && part.inlineData.data) {
                const imageData = part.inlineData.data;
                images.push({
                  url: `data:image/png;base64,${imageData}`
                });
              }
            }
          }
        }
      }
    }

    if (images.length === 0) {
      throw new Error('未从 Gemini 获得任何图像');
    }
    
    console.log(`✅ [${task_id}] 图片生成完成，共 ${images.length} 张`);
    
    // 上传到 R2 或使用 base64
    let artifacts: WebhookCallbackData['artifacts'] = [];
    
    if (r2Validation.valid && r2Bucket && r2PublicUrl) {
      console.log(`☁️  [${task_id}] 开始上传到 R2...`);
      
      const uploadResults = await uploadMultipleImages(
        r2Bucket,
        task_id,
        images,
        r2PublicUrl
      );
      
      if (uploadResults.length > 0) {
        console.log(`✅ [${task_id}] R2 上传完成: ${uploadResults.length}/${images.length} 张`);
        artifacts = uploadResults.map(result => ({
          index: result.index,
          url: result.url,
          size_bytes: result.size_bytes,
        }));
      } else {
        console.warn(`⚠️  [${task_id}] R2 上传失败，使用 base64 数据`);
        artifacts = images.map((img, index) => ({
          index: index + 1,
          url: img.url,
          size_bytes: 0,
        }));
      }
    } else {
      // 没有配置 R2，返回 base64
      console.log(`💾 [${task_id}] 使用 base64 格式`);
      artifacts = images.map((img, index) => ({
        index: index + 1,
        url: img.url,
        size_bytes: 0,
      }));
    }
    
    const generation_time = (Date.now() - startTime) / 1000;
    
    // 回调 Webhook
    const callbackData: WebhookCallbackData = {
      task_id,
      generation_time,
      artifacts,
    };
    
    console.log(`🔔 [${task_id}] 开始回调 Webhook: ${webhook_url}`);
    
    const webhookResponse = await fetch(webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(callbackData),
    });
    
    if (webhookResponse.ok) {
      console.log(`✅ [${task_id}] Webhook 回调成功，状态: ${webhookResponse.status}`);
    } else {
      const errorText = await webhookResponse.text();
      console.error(`❌ [${task_id}] Webhook 回调失败: ${webhookResponse.status} - ${errorText}`);
    }
    
    console.log(`✅ [${task_id}] 任务完成，总耗时: ${generation_time.toFixed(2)}s`);
    
  } catch (error: any) {
    console.error(`❌ [${task_id}] 任务失败:`, error);
    
    // 即使失败也尝试回调 Webhook 通知错误
    try {
      const generation_time = (Date.now() - startTime) / 1000;
      await fetch(webhook_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          task_id,
          generation_time,
          artifacts: [],
          error: {
            code: 'GENERATION_FAILED',
            message: error.message || '图像生成失败',
          },
        }),
      });
    } catch (webhookError) {
      console.error(`❌ [${task_id}] Webhook 错误通知失败:`, webhookError);
    }
  }
}

/**
 * 新增：异步任务创建端点
 */
app.post('/api/generate-image', async (c) => {
  try {
    const body = await c.req.json() as ThirdPartyAIRequest;
    
    const { task_id, prompt, webhook_url, count = 1, options } = body;
    
    // 验证必需参数
    if (!task_id || !prompt || !webhook_url) {
      return c.json({
        success: false,
        error: {
          code: 'MISSING_PARAMETERS',
          message: 'task_id、prompt 和 webhook_url 是必需的参数',
        },
      }, 400);
    }
    
    // 验证 webhook_url 格式
    try {
      new URL(webhook_url);
    } catch {
      return c.json({
        success: false,
        error: {
          code: 'INVALID_WEBHOOK_URL',
          message: 'webhook_url 格式无效',
        },
      }, 400);
    }
    
    // 验证 count
    if (count < 1 || count > 5) {
      return c.json({
        success: false,
        error: {
          code: 'INVALID_COUNT',
          message: 'count 必须在 1-5 之间',
        },
      }, 400);
    }
    
    console.log(`📥 收到任务: ${task_id}`);
    console.log(`📝 Prompt: "${prompt}"`);
    console.log(`🔢 数量: ${count}`);
    console.log(`🔗 Webhook: ${webhook_url}`);
    
    // 获取执行上下文，用于后台任务
    const env = c.env as Env;
    
    // 在后台执行图片生成和回调
    c.executionCtx.waitUntil(
      generateAndCallback(task_id, prompt, webhook_url, count, env)
    );
    
    // 立即返回 task_id
    const response: ThirdPartyAIResponse = {
      task_id,
    };
    
    console.log(`✅ 任务已接受: ${task_id}`);
    
    return c.json(response, 202); // 202 Accepted
    
  } catch (error: any) {
    console.error('❌ 请求处理失败:', error);
    
    return c.json({
      success: false,
      error: {
        code: 'REQUEST_FAILED',
        message: error.message || '请求处理失败',
      },
    }, 500);
  }
});

// 根路径
app.get('/', (c) => {
  return c.json({
    service: 'image-generation-agent',
    version: '2.0.0',
    status: 'running',
    mode: 'async-with-webhook',
    endpoints: [
      'GET  /api/health',
      'POST /api/generate-image (async + webhook)',
    ],
  });
});

// 404 处理
app.notFound((c) => {
  return c.json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: '请求的路径不存在',
      path: c.req.path,
    },
  }, 404);
});

// 错误处理
app.onError((err, c) => {
  console.error('💥 Worker 错误:', err);
  
  return c.json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: err.message || '服务器内部错误',
    },
  }, 500);
});

export default app;