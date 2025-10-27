import { registerApiRoute } from '@mastra/core/server';
import type { ExecutionContext } from '@cloudflare/workers-types';
import { uploadMultipleImages, validateR2Config } from '../utils/r2-storage';
import { smartImageRouterTool } from '../mastra/tools/smart-image-router';
import { TaskAuthServiceD1 } from '../services/task-auth-d1';
import { TaskMemoryServiceD1 } from '../services/task-memory-d1';
import { getTaskQueue } from '../services/task-queue';
import type {
  Env,
  GenerateImageRequest,
  GenerateImageResponse,
  ThirdPartyAIRequest,
  ThirdPartyAIResponse,
  WebhookCallbackData,
} from '../types';

async function uploadArtifactsToR2(
  env: Env,
  taskId: string,
  images: Array<{ url: string; base64: string }>,
) {
  const r2Bucket = env.IMAGE_STORAGE;
  const r2PublicUrl = env.R2_PUBLIC_URL;
  const validation = validateR2Config(r2Bucket, r2PublicUrl);

  if (!validation.valid || !r2Bucket || !r2PublicUrl) {
    console.warn(`⚠️  [${taskId}] R2 未配置或无效: ${validation.error}`);
    return null;
  }

  const uploadResults = await uploadMultipleImages(
    r2Bucket,
    taskId,
    images.map((img) => ({ url: img.url })),
    r2PublicUrl,
  );

  if (uploadResults.length === 0) {
    console.warn(`⚠️  [${taskId}] R2 上传失败，使用 base64 数据回退`);
    return null;
  }

  return uploadResults.map((result) => ({
    index: result.index,
    url: result.url,
    size_bytes: result.size_bytes,
  }));
}

async function processAsyncImageGeneration(
  env: Env,
  payload: ThirdPartyAIRequest,
): Promise<void> {
  const { task_id, prompt, webhook_url, count = 1, options } = payload;
  const startTime = Date.now();

  try {
    console.log(`🎨 [${task_id}] 后台任务开始，生成 ${count} 张图片`);

    const generation = await smartImageRouterTool.execute({
      context: {
        optimized_prompt: prompt,
        count,
        size: options?.size ?? '1024x1024',
        quality: options?.quality ?? 'standard',
        force_model: 'auto',
        task_id,
      },
    } as any);

    console.log(`✅ [${task_id}] 生成完成，得到 ${generation.images.length} 张图片`);

    const artifactsFromR2 = await uploadArtifactsToR2(
      env,
      task_id,
      generation.images.map((img) => ({
        url: img.url,
        base64: img.base64,
      })),
    );

    const artifacts: WebhookCallbackData['artifacts'] =
      artifactsFromR2 ??
      generation.images.map((img, index) => ({
        index: index + 1,
        url: img.url,
        size_bytes: 0,
      }));

    const generationTime = (Date.now() - startTime) / 1000;

    const callbackPayload: WebhookCallbackData = {
      task_id,
      generation_time: generationTime,
      artifacts,
    };

    console.log(`🔔 [${task_id}] 发送 Webhook 回调 -> ${webhook_url}`);

    const response = await fetch(webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ImageGenerationAgent/1.0',
      },
      body: JSON.stringify(callbackPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Webhook 返回错误: ${response.status} ${errorText}`);
    }

    console.log(`✅ [${task_id}] Webhook 回调成功，耗时 ${generationTime.toFixed(2)} 秒`);
  } catch (error: any) {
    console.error(`❌ [${task_id}] 任务失败:`, error);

    try {
      const failurePayload = {
        task_id,
        generation_time: (Date.now() - startTime) / 1000,
        artifacts: [],
        error: {
          code: 'GENERATION_FAILED',
          message: error?.message ?? '图像生成失败',
        },
      };

      await fetch(webhook_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ImageGenerationAgent/1.0',
        },
        body: JSON.stringify(failurePayload),
      });
    } catch (webhookError) {
      console.error(`❌ [${task_id}] Webhook 错误通知失败:`, webhookError);
    }
  }
}

function scheduleAsyncGeneration(
  c: any,
  env: Env,
  payload: ThirdPartyAIRequest,
) {
  const executionCtx: ExecutionContext | undefined = c?.executionCtx;

  const runner = processAsyncImageGeneration(env, payload);
  if (executionCtx && typeof executionCtx.waitUntil === 'function') {
    executionCtx.waitUntil(runner);
  } else {
    runner.catch((err) => {
      console.error(`❌ [${payload.task_id}] 异步生成失败:`, err);
    });
  }
}

async function handleThirdPartyGenerationRequest(
  c: any,
  body: ThirdPartyAIRequest,
) {
  const { task_id, prompt, webhook_url, count = 1, options } = body;

  if (!task_id || !prompt || !webhook_url) {
    return c.json(
      {
        success: false,
        error: {
          code: 'MISSING_PARAMETERS',
          message: 'task_id、prompt 和 webhook_url 是必需的参数',
        },
      },
      400,
    );
  }

  try {
    new URL(webhook_url);
  } catch {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_WEBHOOK_URL',
          message: 'webhook_url 格式无效',
        },
      },
      400,
    );
  }

  if (count < 1 || count > 5) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_COUNT',
          message: 'count 必须在 1-5 之间',
        },
      },
      400,
    );
  }

  const env = c.env as Env;
  scheduleAsyncGeneration(c, env, { task_id, prompt, webhook_url, count, options });

  const response: ThirdPartyAIResponse = { task_id };
  return c.json(response, 202);
}

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
 * 创建 token 路由
 * 入参: { task_id: string }
 * 返回: { success: boolean, task_id: string, secret_token: string }
 */
export const createTokenRoute = registerApiRoute('/create-token', {
  method: 'POST',
  handler: async (c) => {
    try {
      const body = await c.req.json<{ task_id: string }>();
      const { task_id } = body;

      // 验证必需参数
      if (!task_id) {
        return c.json({
          success: false,
          error: {
            code: 'MISSING_PARAMETERS',
            message: 'task_id 是必需的参数',
          },
        }, 400);
      }

      // 验证 task_id 格式（可选，根据需要调整）
      if (typeof task_id !== 'string' || task_id.trim().length === 0) {
        return c.json({
          success: false,
          error: {
            code: 'INVALID_TASK_ID',
            message: 'task_id 格式无效',
          },
        }, 400);
      }

      const env = c.env as Env;
      const taskAuth = new TaskAuthServiceD1(env.DB);

      // 检查是否已存在 active token
      const existingToken = await taskAuth.getActiveToken(task_id);
      if (existingToken) {
        return c.json({
          success: false,
          task_id,
          error: {
            code: 'TOKEN_ALREADY_EXISTS',
            message: '该 task_id 已存在 active token，请使用现有 token 或等待其过期',
          },
        }, 409); // 409 Conflict
      }

      // 生成新的 secret_token
      const secret_token = await taskAuth.createAuth(task_id);

      console.log(`🔑 [CreateToken] 为 taskId ${task_id} 生成新 secret_token`);

      return c.json({
        success: true,
        task_id,
        secret_token,
        message: '成功生成 secret_token，请在后续请求中携带此 token',
        expires_in: '30 days', // 根据实际配置调整
      });
    } catch (error: any) {
      console.error('❌ [CreateToken] 失败:', error);
      return c.json({
        success: false,
        error: {
          code: 'CREATE_TOKEN_FAILED',
          message: error.message || '生成 token 失败',
        },
      }, 500);
    }
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
    let secret_token: string | undefined;
    let new_secret_token: string | undefined;

    try {
      const rawBody = await c.req.json<any>();

      if (typeof rawBody?.webhook_url === 'string' && !rawBody?.secret_token) {
        return await handleThirdPartyGenerationRequest(c, rawBody as ThirdPartyAIRequest);
      }

      const body = rawBody as GenerateImageRequest & { secret_token?: string };

      task_id = body.task_id;
      secret_token = body.secret_token;
      prompt = body.prompt;
      size = body.options?.size ?? '1024x1024';
      quality = body.options?.quality ?? 'standard';

      // 验证必需参数：task_id, prompt, secret_token 都是必需的
      if (!task_id || !prompt || !secret_token) {
        return c.json<GenerateImageResponse>({
          success: false,
          task_id: task_id || 'unknown',
          generation_time: 0,
          error: {
            code: 'MISSING_PARAMETERS',
            message: 'task_id, prompt 和 secret_token 是必需的参数',
          },
        }, 400);
      }

      // 解析 count 并验证范围
      const parsedCount =
        typeof body.count === 'number'
          ? body.count
          : typeof body.count === 'string'
            ? Number(body.count)
            : 1;

      if (!Number.isFinite(parsedCount) || !Number.isInteger(parsedCount)) {
        return c.json<GenerateImageResponse>({
          success: false,
          task_id,
          generation_time: 0,
          error: {
            code: 'INVALID_COUNT',
            message: 'count 必须是 1-5 之间的整数',
          },
        }, 400);
      }

      count = parsedCount;

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

      // 鉴权验证：验证 secret_token 并轮换
      const env = c.env as Env;
      const taskAuth = new TaskAuthServiceD1(env.DB);
      const authResult = await taskAuth.verifyAndRotate(secret_token);

      if (!authResult.valid) {
        const errorMessages = {
          'TOKEN_INVALID': 'secret_token 格式无效或已被篡改',
          'TOKEN_REVOKED': 'secret_token 已被撤销（可能已使用过）',
          'TOKEN_NOT_FOUND': 'secret_token 不存在',
        };

        return c.json<GenerateImageResponse>({
          success: false,
          task_id,
          generation_time: 0,
          error: {
            code: authResult.error || 'AUTH_FAILED',
            message: errorMessages[authResult.error || 'TOKEN_INVALID'] || '鉴权失败',
          },
        }, 403);
      }

      // 验证 taskId 是否匹配
      if (authResult.task_id !== task_id) {
        return c.json<GenerateImageResponse>({
          success: false,
          task_id,
          generation_time: 0,
          error: {
            code: 'TASK_ID_MISMATCH',
            message: 'task_id 与 secret_token 不匹配',
          },
        }, 403);
      }

      // ✅ 验证成功，生成新的 secret_token
      new_secret_token = authResult.new_token!;

      console.log(`🔐 [Auth] secret_token 验证成功: taskId=${task_id}`);
      console.log(`🔑 [Auth] 旧 token 已作废，生成新 secret_token`)
      
      console.log(`📥 收到任务: ${task_id}`);
      console.log(`📝 Prompt: "${prompt}"`);
      console.log(`🔢 数量: ${count}`);
      console.log(`📐 尺寸: ${size}`);

      // 检查历史记录
      const taskMemory = new TaskMemoryServiceD1(env.DB);
      const history = await taskMemory.getHistory(task_id);

      if (history) {
        console.log(`📚 [记忆] 找到该任务的历史记录:`);
        console.log(`   - 总共生成过 ${history.total_generations} 次`);
        console.log(`   - 首次生成: ${history.first_generation}`);
        console.log(`   - 最近生成: ${history.last_generation}`);

        const lastGen = history.entries[0];
        console.log(`   - 上次 Prompt: "${lastGen.prompt}"`);
        console.log(`   - 上次生成: ${lastGen.count} 张图片`);
      } else {
        console.log(`📚 [记忆] 这是该任务的首次生成`);
      }

      // 获取 R2 配置
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
      
      if (r2Validation.valid && r2Bucket && r2PublicUrl) {
        console.log(`☁️  开始上传到 R2...`);
        
        const uploadResults = await uploadMultipleImages(
          r2Bucket,
          task_id,
          generationResult.images,
          r2PublicUrl
        );
        
        if (uploadResults.length > 0) {
          console.log(`✅ R2 上传完成: ${uploadResults.length}/${generationResult.total_count} 张`);
          finalImages = uploadResults;
        } else {
          console.warn(`⚠️  R2 上传全部失败，使用本地路径`);
          // 使用本地路径作为备选
          finalImages = generationResult.images.map((img, index) => ({
            index: index + 1,
            url: img.local_path,
            storage_key: img.local_path,
            file_name: img.file_name,
            size_bytes: 0,
          }));
        }
      } else {
        // 没有配置 R2，使用本地路径
        console.log(`💾 使用本地存储模式`);
        finalImages = generationResult.images.map((img, index) => ({
          index: index + 1,
          url: img.url, // 这里可能是本地路径或者 R2 URL（如果在工具中已经上传）
          storage_key: img.r2_key || img.local_path,
          file_name: img.file_name,
          size_bytes: 0,
        }));
      }
      
      const totalTime = (Date.now() - startTime) / 1000;
      
      console.log(`✅ 任务完成: ${task_id}, 耗时: ${totalTime.toFixed(2)}s`);
      console.log(`📊 成功: ${finalImages.length}/${count} 张`);

      // 保存到任务记忆
      await taskMemory.saveMemory({
        task_id,
        prompt,
        optimized_prompt: prompt, // 可以从 Agent 获取优化后的 prompt
        generated_images: finalImages.map(img => ({
          url: img.url,
          r2_key: img.storage_key,
          file_name: img.file_name,
          storage_type: img.url.startsWith('http') ? 'r2' : 'local',
        })),
        count: finalImages.length,
      });

      return c.json<GenerateImageResponse & { secret_token?: string }>({
        success: true,
        task_id,
        secret_token: new_secret_token, // 🔑 返回轮换后的新 secret_token
        total_images: finalImages.length,
        images: finalImages,
        generation_time: totalTime,
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
 * 异步图像生成路由（返回 job_id，后台处理）
 */
export const generateAsyncRoute = registerApiRoute('/generate-async', {
  method: 'POST',
  handler: async (c) => {
    try {
      const body = await c.req.json<GenerateImageRequest & { webhook_url?: string; secret_token?: string }>();

      const { task_id, prompt, count = 1, options, webhook_url, secret_token } = body;

      // 验证必需参数
      if (!task_id || !prompt || !secret_token) {
        return c.json({
          success: false,
          error: {
            code: 'MISSING_PARAMETERS',
            message: 'task_id, prompt 和 secret_token 是必需的参数',
          },
        }, 400);
      }

      if (count < 1 || count > 5) {
        return c.json({
          success: false,
          task_id,
          error: {
            code: 'INVALID_COUNT',
            message: 'count 必须在 1-5 之间',
          },
        }, 400);
      }

      const env = c.env as Env;
      const taskAuth = new TaskAuthServiceD1(env.DB);
      const authResult = await taskAuth.verifyAndRotate(secret_token);

      if (!authResult.valid) {
        const errorMessages = {
          'TOKEN_INVALID': 'secret_token 格式无效或已被篡改',
          'TOKEN_REVOKED': 'secret_token 已被撤销（可能已使用过）',
          'TOKEN_NOT_FOUND': 'secret_token 不存在',
        };

        return c.json({
          success: false,
          task_id,
          error: {
            code: authResult.error || 'AUTH_FAILED',
            message: errorMessages[authResult.error || 'TOKEN_INVALID'] || '鉴权失败',
          },
        }, 403);
      }

      if (authResult.task_id !== task_id) {
        return c.json({
          success: false,
          task_id,
          error: {
            code: 'TASK_ID_MISMATCH',
            message: 'task_id 与 secret_token 不匹配',
          },
        }, 403);
      }

      const nextSecretToken = authResult.new_token!;

      // 生成唯一的 job_id
      const job_id = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // 添加到任务队列
      const taskQueue = getTaskQueue();
      taskQueue.addTask({
        job_id,
        task_id,
        prompt,
        count,
        options,
        webhook_url,
      });

      console.log(`📥 [Async] 任务已加入队列: ${job_id}`);

      // 立即返回 job_id
      return c.json({
        success: true,
        job_id,
        task_id,
        status: 'pending',
        secret_token: nextSecretToken,
        message: '任务已加入队列，请通过 /api/job/:jobId 查询状态',
        query_url: `/api/job/${job_id}`,
      });
    } catch (error: any) {
      return c.json({
        success: false,
        error: {
          code: 'REQUEST_FAILED',
          message: error.message || '请求处理失败',
        },
      }, 500);
    }
  },
});

/**
 * 查询异步任务状态
 */
export const jobStatusRoute = registerApiRoute('/job/:jobId', {
  method: 'GET',
  handler: async (c) => {
    const jobId = c.req.param('jobId');

    try {
      const taskQueue = getTaskQueue();
      const task = taskQueue.getTask(jobId);

      if (!task) {
        return c.json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: '未找到该任务',
          },
        }, 404);
      }

      return c.json({
        success: true,
        job_id: task.job_id,
        task_id: task.task_id,
        status: task.status,
        result: task.result,
        error: task.error,
        created_at: task.created_at,
        started_at: task.started_at,
        completed_at: task.completed_at,
        retry_count: task.retry_count,
      });
    } catch (error: any) {
      return c.json({
        success: false,
        error: {
          code: 'QUERY_FAILED',
          message: error.message || '查询失败',
        },
      }, 500);
    }
  },
});

/**
 * 批量生成路由（保留）
 */
export const generateBatchRoute = registerApiRoute('/generate-batch', {
  method: 'POST',
  handler: async (c) => {
    return c.json({
      success: false,
      error: {
        code: 'DEPRECATED',
        message: '请使用 /api/generate-async 接口',
      },
    }, 410);
  },
});

/**
 * 查询任务历史记录（JSON 格式）
 */
export const taskStatusRoute = registerApiRoute('/task/:taskId', {
  method: 'GET',
  handler: async (c) => {
    const taskId = c.req.param('taskId');
    const secretToken = c.req.query('secret_token');

    try {
      // 鉴权验证（查询不需要轮换 token，只验证）
      if (!secretToken) {
        return c.json({
          success: false,
          task_id: taskId,
          error: {
            code: 'MISSING_SECRET_TOKEN',
            message: '需要提供 secret_token 进行鉴权',
          },
        }, 401);
      }

      const env = c.env as Env;
      const taskAuth = new TaskAuthServiceD1(env.DB);
      const authResult = await taskAuth.verifyAndRotate(secretToken);

      if (!authResult.valid || authResult.task_id !== taskId) {
        return c.json({
          success: false,
          task_id: taskId,
          error: {
            code: authResult.error || 'AUTH_FAILED',
            message: '鉴权失败，无法查询该任务',
          },
        }, 403);
      }

      const taskMemory = new TaskMemoryServiceD1(env.DB);
      const history = await taskMemory.getHistory(taskId);

      if (!history) {
        return c.json({
          success: false,
          task_id: taskId,
          error: {
            code: 'NOT_FOUND',
            message: '未找到该任务的历史记录',
          },
        }, 404);
      }

      return c.json({
        success: true,
        task_id: taskId,
        history: {
          total_generations: history.total_generations,
          first_generation: history.first_generation,
          last_generation: history.last_generation,
          entries: history.entries.map(entry => ({
            prompt: entry.prompt,
            optimized_prompt: entry.optimized_prompt,
            count: entry.count,
            images: entry.generated_images,
            created_at: entry.created_at,
            expires_at: entry.expires_at,
          })),
        },
      });
    } catch (error: any) {
      return c.json({
        success: false,
        task_id: taskId,
        error: {
          code: 'QUERY_FAILED',
          message: error.message || '查询失败',
        },
      }, 500);
    }
  },
});

/**
 * 导出任务历史记录为 Markdown
 */
export const exportTaskMarkdownRoute = registerApiRoute('/task/:taskId/export', {
  method: 'GET',
  handler: async (c) => {
    const taskId = c.req.param('taskId');
    const secretToken = c.req.query('secret_token');

    try {
      // 鉴权验证
      if (!secretToken) {
        return c.json({
          success: false,
          error: {
            code: 'MISSING_SECRET_TOKEN',
            message: '需要提供 secret_token 进行鉴权',
          },
        }, 401);
      }

      const env = c.env as Env;
      const taskAuth = new TaskAuthServiceD1(env.DB);
      const authResult = await taskAuth.verifyAndRotate(secretToken);

      if (!authResult.valid || authResult.task_id !== taskId) {
        return c.json({
          success: false,
          error: {
            code: authResult.error || 'AUTH_FAILED',
            message: '鉴权失败，无法导出该任务',
          },
        }, 403);
      }

      const taskMemory = new TaskMemoryServiceD1(env.DB);
      const history = await taskMemory.getHistory(taskId);

      if (!history) {
        return c.json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: '未找到该任务的历史记录',
          },
        }, 404);
      }

      // 生成 Markdown 内容
      let markdown = `# 图像生成历史记录\n\n`;
      markdown += `**Task ID:** \`${taskId}\`\n\n`;
      markdown += `**总生成次数:** ${history.total_generations}\n\n`;
      markdown += `**首次生成:** ${new Date(history.first_generation).toLocaleString('zh-CN')}\n\n`;
      markdown += `**最近生成:** ${new Date(history.last_generation).toLocaleString('zh-CN')}\n\n`;
      markdown += `---\n\n`;

      history.entries.forEach((entry, index) => {
        const entryNumber = history.total_generations - index;
        markdown += `## 第 ${entryNumber} 次生成\n\n`;
        markdown += `**时间:** ${new Date(entry.created_at).toLocaleString('zh-CN')}\n\n`;
        markdown += `**原始 Prompt:**\n\`\`\`\n${entry.prompt}\n\`\`\`\n\n`;

        if (entry.optimized_prompt && entry.optimized_prompt !== entry.prompt) {
          markdown += `**优化后 Prompt:**\n\`\`\`\n${entry.optimized_prompt}\n\`\`\`\n\n`;
        }

        markdown += `**生成数量:** ${entry.count} 张\n\n`;
        markdown += `**生成图片:**\n\n`;

        entry.generated_images.forEach((img, imgIndex) => {
          markdown += `${imgIndex + 1}. **${img.file_name}**\n`;
          markdown += `   - 存储类型: ${img.storage_type === 'r2' ? 'Cloudflare R2' : '本地存储'}\n`;
          markdown += `   - URL: ${img.url}\n`;
          if (img.r2_key) {
            markdown += `   - R2 Key: ${img.r2_key}\n`;
          }
          markdown += `\n`;
        });

        markdown += `**过期时间:** ${new Date(entry.expires_at).toLocaleString('zh-CN')}\n\n`;
        markdown += `---\n\n`;
      });

      markdown += `\n*导出时间: ${new Date().toLocaleString('zh-CN')}*\n`;

      // 返回 Markdown 文件
      return c.text(markdown, 200, {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="task-${taskId}-history.md"`,
      });
    } catch (error: any) {
      return c.json({
        success: false,
        error: {
          code: 'EXPORT_FAILED',
          message: error.message || '导出失败',
        },
      }, 500);
    }
  },
});

// 导出所有路由
export const routes = [
  healthRoute,
  createTokenRoute,
  generateImageRoute,
  generateAsyncRoute,
  jobStatusRoute,
  generateBatchRoute,
  taskStatusRoute,
  exportTaskMarkdownRoute,
];

export default { routes };
