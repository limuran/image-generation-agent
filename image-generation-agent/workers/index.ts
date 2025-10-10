/**
 * Cloudflare Workers 入口文件
 * 修复版：直接集成图像生成逻辑，无需依赖 Mastra 路由
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from '../src/types';
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
    version: '1.0.0',
  });
});

// 图像生成路由
app.post('/api/generate-image', async (c) => {
  const startTime = Date.now();
  let task_id: string | undefined;
  
  try {
    const body = await c.req.json();
    
    task_id = body.task_id;
    const prompt = body.prompt;
    const count = body.count ?? 1;
    const size = body.options?.size ?? '1024x1024';
    
    // 验证参数
    if (!task_id || !prompt) {
      return c.json({
        success: false,
        task_id: task_id || 'unknown',
        generation_time: 0,
        error: {
          code: 'MISSING_PARAMETERS',
          message: 'task_id 和 prompt 是必需的参数',
        },
      }, 400);
    }
    
    if (count < 1 || count > 5) {
      return c.json({
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
    
    // 获取环境变量
    const env = c.env as Env;
    const googleApiKey = env.GOOGLE_API_KEY;
    const r2Bucket = env.IMAGE_STORAGE;
    const r2PublicUrl = env.R2_PUBLIC_URL;
    
    if (!googleApiKey) {
      return c.json({
        success: false,
        task_id,
        generation_time: 0,
        error: {
          code: 'MISSING_API_KEY',
          message: '未配置 GOOGLE_API_KEY',
        },
      }, 500);
    }
    
    // 验证 R2 配置
    const r2Validation = validateR2Config(r2Bucket, r2PublicUrl);
    if (!r2Validation.valid) {
      console.warn(`⚠️  R2 配置警告: ${r2Validation.error}`);
    }
    
    // 初始化 Gemini 客户端
    const ai = new GoogleGenAI({ apiKey: googleApiKey });
    const images: Array<{ url: string }> = [];
    
    // 生成图片
    console.log(`🎨 开始生成图片...`);
    
    for (let i = 0; i < Math.min(count, 4); i++) {
      console.log(`⏳ 正在生成第 ${i + 1}/${count} 张图片...`);
      
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
    
    console.log(`✅ 图片生成完成，共 ${images.length} 张`);
    
    // 上传到 R2
    let finalImages;
    
    if (r2Validation.valid && r2Bucket && r2PublicUrl) {
      console.log(`☁️  开始上传到 R2...`);
      
      const uploadResults = await uploadMultipleImages(
        r2Bucket,
        task_id,
        images,
        r2PublicUrl
      );
      
      if (uploadResults.length > 0) {
        console.log(`✅ R2 上传完成: ${uploadResults.length}/${images.length} 张`);
        finalImages = uploadResults;
      } else {
        console.warn(`⚠️  R2 上传失败，返回 base64 数据`);
        finalImages = images.map((img, index) => ({
          index: index + 1,
          url: img.url,
          storage_key: 'base64',
          file_name: `image_${index + 1}.png`,
          size_bytes: 0,
        }));
      }
    } else {
      // 没有配置 R2，返回 base64
      console.log(`💾 使用 base64 格式返回`);
      finalImages = images.map((img, index) => ({
        index: index + 1,
        url: img.url,
        storage_key: 'base64',
        file_name: `image_${index + 1}.png`,
        size_bytes: 0,
      }));
    }
    
    const totalTime = (Date.now() - startTime) / 1000;
    
    console.log(`✅ 任务完成: ${task_id}, 耗时: ${totalTime.toFixed(2)}s`);
    
    return c.json({
      success: true,
      task_id,
      total_images: finalImages.length,
      images: finalImages,
      generation_time: totalTime,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      metadata: {
        prompt,
        requested_count: count,
        actual_count: finalImages.length,
        model_used: 'gemini-2.5-flash-image',
      },
    });
    
  } catch (error: any) {
    console.error('❌ 处理失败:', error);
    const totalTime = (Date.now() - startTime) / 1000;
    
    return c.json({
      success: false,
      task_id: task_id || 'unknown',
      generation_time: totalTime,
      error: {
        code: 'GENERATION_FAILED',
        message: error.message || '图像生成失败',
      },
    }, 500);
  }
});

// 根路径
app.get('/', (c) => {
  return c.json({
    service: 'image-generation-agent',
    version: '1.0.0',
    status: 'running',
    endpoints: [
      'GET  /api/health',
      'POST /api/generate-image',
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