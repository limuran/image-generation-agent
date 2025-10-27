
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { weatherWorkflow } from './workflows/weather-workflow';
import { weatherAgent } from './agents/weather-agent';
import { imageGenerationAgent } from './agents/image-agent';
import { routes } from '../api/routes';
import { getTaskQueue, type Task } from '../services/task-queue';
import { smartImageRouterTool } from './tools/smart-image-router';

type AsyncTaskResult = {
  total_images: number;
  images: Array<{
    index: number;
    url: string;
    storage_key: string;
    file_name: string;
    storage_type: 'r2' | 'local';
  }>;
  generation_time: number;
  metadata: {
    prompt: string;
    requested_count: number;
    model_used: string;
  };
};

async function executeAsyncTask(task: Task): Promise<AsyncTaskResult> {
  const startTime = Date.now();
  const options = task.options || {};

  const generation = await smartImageRouterTool.execute({
    context: {
      optimized_prompt: task.prompt,
      count: task.count,
      size: options.size ?? '1024x1024',
      quality: options.quality ?? 'standard',
      force_model: 'auto',
      task_id: task.task_id,
    },
  } as any);

  const finalImages = generation.images.map((img, index) => ({
    index: index + 1,
    url: img.url,
    storage_key: img.r2_key || img.local_path,
    file_name: img.file_name,
    storage_type: img.storage_type,
  }));

  const totalTime = (Date.now() - startTime) / 1000;

  // TODO: 需要 D1 实例才能保存任务记忆
  // 异步任务队列在 Workers 环境可能不适用（执行时间限制）
  // const taskMemory = new TaskMemoryServiceD1(db);
  // await taskMemory.saveMemory({ ... });

  return {
    total_images: finalImages.length,
    images: finalImages,
    generation_time: totalTime,
    metadata: {
      prompt: task.prompt,
      requested_count: task.count,
      model_used: generation.images[0]?.model_used ?? 'mock-image-generator',
    },
  };
}

type MastraFactoryOptions = {
  /**
   * 控制是否启用内存任务队列处理器。
   * Cloudflare Workers 环境不支持长时间运行的定时器，应设置为 false。
   */
  enableAsyncProcessor?: boolean;
};

const isNodeEnvironment = typeof process !== 'undefined' && !!process.versions?.node;
const isCloudflareWorker =
  typeof navigator !== 'undefined' && navigator.userAgent?.includes('Cloudflare-Workers');

function ensureAsyncProcessor(enable: boolean | undefined) {
  if (!enable) {
    return;
  }

  if (typeof setInterval !== 'function') {
    console.warn('⚠️  [TaskQueue] 当前环境不支持 setInterval，异步任务将无法自动处理');
    return;
  }

  const queue = getTaskQueue();

  if (queue.hasProcessor()) {
    return;
  }

  queue.startProcessing(async (task) => {
    try {
      return await executeAsyncTask(task);
    } catch (error) {
      console.error('💥 [TaskQueue] 异步任务执行失败:', error);
      throw error;
    }
  });
}

/**
 * Mastra 实例工厂函数
 * 用于在 Cloudflare Workers 环境中动态创建 Mastra 实例
 *
 * @param apiKey - Google Gemini API Key
 * @returns Mastra 实例
 */
export function createMastra(apiKeyOrOptions?: string | MastraFactoryOptions, maybeOptions?: MastraFactoryOptions) {
  console.log('🏗️ [MASTRA] Creating Mastra instance');

  const options: MastraFactoryOptions =
    typeof apiKeyOrOptions === 'string'
      ? { ...maybeOptions }
      : { ...(apiKeyOrOptions ?? {}) };

  const apiKey = typeof apiKeyOrOptions === 'string' ? apiKeyOrOptions : undefined;

  if (apiKey) {
    console.log('🔑 [MASTRA] API key provided via parameter');
  }

  const asyncProcessorEnabled =
    options.enableAsyncProcessor ?? (isNodeEnvironment && !isCloudflareWorker);

  const mastraInstance = new Mastra({
    workflows: { weatherWorkflow },
    agents: { weatherAgent, imageGenerationAgent },
    logger: new PinoLogger({
      name: 'Mastra',
      level: 'info',
    }),
    server: {
      port: 4111,
      host: '0.0.0.0',
      // 注册自定义API路由
      apiRoutes: routes,
    },
  });

  console.log('✅ [MASTRA] Mastra instance created successfully');
  ensureAsyncProcessor(asyncProcessorEnabled);

  return mastraInstance;
}

/**
 * 默认 Mastra 实例（用于本地开发 mastra dev）
 * 在 Cloudflare Workers 中，应该使用 createMastra() 工厂函数
 */
export const mastra =
  isNodeEnvironment && !isCloudflareWorker ? createMastra() : null;
