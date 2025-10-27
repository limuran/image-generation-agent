import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { GoogleGenAI } from '@google/genai';
import { isR2Configured, uploadToR2 } from '../../utils/r2-uploader';

const GOOGLE_GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
const MAX_IMAGES_PER_REQUEST = 4;
const MOCK_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVQImWNggID/BwAAAwABWMX7LwAAAABJRU5ErkJggg==';

type RuntimeEnv = {
  isNode: boolean;
  googleApiKey?: string;
  mockImageGeneration: boolean;
  r2Configured: boolean;
};

let cachedClient: GoogleGenAI | null = null;
let cachedClientKey: string | undefined;
let nodePathModule: typeof import('path') | null = null;
let nodeFsModule: typeof import('fs') | null = null;
let nodeFsPromisesModule: typeof import('fs/promises') | null = null;

function readGlobalEnv(name: string): string | undefined {
  if (typeof globalThis === 'undefined') {
    return undefined;
  }

  const directValue = (globalThis as Record<string, unknown>)[name];
  if (typeof directValue === 'string') {
    return directValue;
  }

  const envObject = (globalThis as Record<string, unknown>).ENV;
  if (envObject && typeof envObject === 'object') {
    const envValue = (envObject as Record<string, unknown>)[name];
    if (typeof envValue === 'string') {
      return envValue;
    }
  }

  return undefined;
}

function detectRuntimeEnv(): RuntimeEnv {
  const isNodeProcess = typeof process !== 'undefined' && !!process.versions?.node;
  const isCloudflareWorker =
    typeof navigator !== 'undefined' && navigator.userAgent?.includes('Cloudflare-Workers');
  const isNode = isNodeProcess && !isCloudflareWorker;
  const googleApiKey =
    (isNode ? process.env?.GOOGLE_API_KEY : undefined) ?? readGlobalEnv('GOOGLE_API_KEY');
  const mockFlag =
    (isNode ? process.env?.MOCK_IMAGE_GENERATION : undefined) ??
    readGlobalEnv('MOCK_IMAGE_GENERATION');

  return {
    isNode,
    googleApiKey: googleApiKey || undefined,
    mockImageGeneration: mockFlag === 'true' || !googleApiKey,
    r2Configured: isNode && isR2Configured(),
  };
}

function decodeBase64(data: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(data, 'base64');
  }

  const binaryString = atob(data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function ensureNodeModules() {
  if (!nodePathModule) {
    nodePathModule = await import('path');
  }
  if (!nodeFsModule) {
    nodeFsModule = await import('fs');
  }
  if (!nodeFsPromisesModule) {
    nodeFsPromisesModule = await import('fs/promises');
  }
}

async function ensureOutputDirectory(runtime: RuntimeEnv): Promise<string | null> {
  if (!runtime.isNode) {
    return null;
  }

  await ensureNodeModules();
  const outputDir = nodePathModule!.join(process.cwd(), 'output');
  if (!nodeFsModule!.existsSync(outputDir)) {
    nodeFsModule!.mkdirSync(outputDir, { recursive: true });
  }
  return outputDir;
}

async function persistLocalBackup(
  runtime: RuntimeEnv,
  base64Data: string,
  outputDir: string | null,
  index: number
): Promise<{ fileName: string; localPath: string }> {
  const timestamp = Date.now();
  const fileName = `gemini_${timestamp}_${index}.png`;

  if (!runtime.isNode || !outputDir) {
    return { fileName, localPath: fileName };
  }

  await ensureNodeModules();

  const filePath = nodePathModule!.join(outputDir, fileName);
  const bytes = decodeBase64(base64Data);
  await nodeFsPromisesModule!.writeFile(filePath, Buffer.from(bytes));

  return { fileName, localPath: filePath };
}

function createGoogleClient(runtime: RuntimeEnv): GoogleGenAI {
  if (!runtime.googleApiKey) {
    throw new Error('GOOGLE_API_KEY_NOT_AVAILABLE');
  }

  if (!cachedClient || cachedClientKey !== runtime.googleApiKey) {
    cachedClient = new GoogleGenAI({ apiKey: runtime.googleApiKey });
    cachedClientKey = runtime.googleApiKey;
  }

  return cachedClient;
}

async function generateImagesFromGemini(prompt: string, runtime: RuntimeEnv): Promise<string[]> {
  if (runtime.mockImageGeneration) {
    return [MOCK_IMAGE_BASE64];
  }

  const client = createGoogleClient(runtime);
  const response = await client.models.generateContent({
    model: GOOGLE_GEMINI_IMAGE_MODEL,
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
  });

  const images: string[] = [];

  if (response.candidates && response.candidates.length > 0) {
    for (const candidate of response.candidates) {
      if (!candidate.content?.parts) continue;
      for (const part of candidate.content.parts) {
        if (part.inlineData?.data) {
          images.push(part.inlineData.data);
        }
      }
    }
  }

  return images;
}

const extractErrorMessage = (error: unknown): string => {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in (error as Record<string, unknown>)) {
    return String((error as Record<string, unknown>).message);
  }
  return String(error);
};

export const smartImageRouterTool = createTool({
  id: 'smart-image-router',
  description:
    '使用 Google Gemini 2.5 Flash Image 生成高质量图像；在 Cloudflare Workers 中返回 Base64 数据，由上层负责上传。',

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
    task_id: z.string().optional().describe('任务 ID（用于存储路径、可选）'),
  }),

  outputSchema: z.object({
    images: z.array(
      z.object({
        url: z.string().describe('图片的可访问地址（R2、本地路径或 data URL）'),
        base64: z.string().describe('Base64 数据或占位字符串（取决于运行环境）'),
        r2_key: z.string().optional().describe('R2 存储路径（由上层设置）'),
        local_path: z.string().describe('本地路径（仅 Node 环境）'),
        file_name: z.string().describe('文件名'),
        storage_type: z.enum(['r2', 'local']).describe('存储类型'),
        model_used: z.string().describe('使用的模型'),
      }),
    ),
    total_count: z.number(),
    generation_time: z.number().describe('生成耗时（秒）'),
    output_directory: z.string().describe('本地输出目录（或虚拟路径）'),
  }),

  execute: async ({ context }) => {
    const {
      optimized_prompt,
      count,
      size,
      quality,
      force_model,
      task_id,
    } = context as {
      optimized_prompt: string;
      count: number;
      size: '1024x1024' | '1024x1792' | '1792x1024';
      quality: 'standard' | 'hd';
      force_model: 'auto' | 'google-gemini-image' | 'google-imagen';
      task_id?: string;
    };
    const runtime = detectRuntimeEnv();
    const targetCount = Math.min(count, MAX_IMAGES_PER_REQUEST);

    const startTime = Date.now();
    const outputDir = runtime.r2Configured ? null : await ensureOutputDirectory(runtime);
    const resolvedTaskId = task_id ?? `task_${Date.now()}`;
    const images: Array<{
      url: string;
      base64: string;
      r2_key?: string;
      local_path: string;
      file_name: string;
      storage_type: 'r2' | 'local';
      model_used: string;
    }> = [];

    try {
      console.log(`🎨 开始生成图片...`);
      console.log(`📝 Prompt: ${optimized_prompt}`);
      console.log(`🔢 数量: ${targetCount}`);
      console.log(`📐 尺寸: ${size}`);
      console.log(`🎚️  质量: ${quality}`);
      console.log(`🎯 模型策略: ${force_model}`);
      console.log(
        `🧪  模式: ${runtime.mockImageGeneration ? 'Mock (本地占位图)' : 'Google Gemini 2.5 Flash Image'}`
      );

      for (let i = 0; i < targetCount; i++) {
        console.log(`⏳ 正在生成第 ${i + 1}/${targetCount} 张图片...`);
        const base64Images = await generateImagesFromGemini(optimized_prompt, runtime);

        for (const base64Data of base64Images) {
          const imageIndex = images.length + 1;
          const { fileName, localPath } = await persistLocalBackup(
            runtime,
            base64Data,
            outputDir,
            imageIndex
          );

          let storageType: 'r2' | 'local' = 'local';
          let r2Key: string | undefined;
          let url = `data:image/png;base64,${base64Data}`;
          let base64Payload = base64Data;

          if (runtime.isNode) {
            base64Payload = '[[base64 omitted in Node runtime]]';
            url = localPath;

            if (runtime.r2Configured) {
              try {
                const uploadResult = await uploadToR2(base64Data, resolvedTaskId, imageIndex);
                if (uploadResult.success) {
                  storageType = 'r2';
                  r2Key = uploadResult.key;
                  url = uploadResult.url;
                  base64Payload = `r2://${uploadResult.key}`;
                  console.log(`☁️  已上传到 R2: ${uploadResult.url}`);
                } else {
                  console.warn(
                    `⚠️  R2 上传失败（使用本地路径回退）: ${uploadResult.error ?? 'unknown error'}`,
                  );
                }
              } catch (uploadError) {
                console.error('❌ R2 上传过程中发生错误，使用本地路径回退:', uploadError);
              }
            }
          }

          images.push({
            url,
            base64: base64Payload,
            r2_key: r2Key,
            local_path: localPath,
            file_name: fileName,
            storage_type: storageType,
            model_used: runtime.mockImageGeneration ? 'mock-image-generator' : GOOGLE_GEMINI_IMAGE_MODEL,
          });
        }
      }

      if (images.length === 0) {
        throw new Error('未从 Gemini 获得任何图像数据');
      }

      const generationTime = (Date.now() - startTime) / 1000;

      console.log(`\n🎉 生成完成！`);
      console.log(`📊 总数: ${images.length} 张`);
      console.log(`⏱️  耗时: ${generationTime.toFixed(2)} 秒`);
      console.log(`📁 输出目录: ${outputDir ?? 'worker://memory'}\n`);

      return {
        images,
        total_count: images.length,
        generation_time: generationTime,
        output_directory: outputDir ?? 'worker://memory',
      };
    } catch (error) {
      const message = extractErrorMessage(error);
      console.error('❌ 图像生成失败:', message);

      let friendlyError = message;
      const suggestions: string[] = [];

      if (message.includes('GOOGLE_API_KEY_NOT_AVAILABLE')) {
        friendlyError = '未设置 GOOGLE_API_KEY';
        suggestions.push('在 Cloudflare 上通过 `wrangler secret put GOOGLE_API_KEY` 配置密钥');
      } else if (message.includes('quota') || message.includes('RESOURCE_EXHAUSTED')) {
        friendlyError = 'Google API 配额已用完';
        suggestions.push('等待配额恢复或使用新的 API Key');
      }

      if (suggestions.length > 0) {
        console.error('\n💡 建议:');
        suggestions.forEach((item) => console.error(`   - ${item}`));
      }

      throw new Error(JSON.stringify({ error: friendlyError, suggestions }));
    }
  },
});

export default smartImageRouterTool;
