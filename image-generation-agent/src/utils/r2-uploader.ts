// 注意：Cloudflare Workers 环境不提供 AWS SDK 依赖的 DOMParser。
// 因此仅在 Node.js（如 mastra dev、本地脚本）中动态加载 AWS SDK。
type AwsSdkModule = typeof import('@aws-sdk/client-s3');

let awsSdkModule: AwsSdkModule | null = null;
let s3ClientSingleton: InstanceType<AwsSdkModule['S3Client']> | null = null;

// R2 配置（仅 Node.js 环境可用）
const R2_ACCOUNT_ID = typeof process !== 'undefined' ? process.env.R2_ACCOUNT_ID : undefined;
const R2_ACCESS_KEY_ID = typeof process !== 'undefined' ? process.env.R2_ACCESS_KEY_ID : undefined;
const R2_SECRET_ACCESS_KEY = typeof process !== 'undefined' ? process.env.R2_SECRET_ACCESS_KEY : undefined;
const R2_BUCKET_NAME = typeof process !== 'undefined' ? process.env.R2_BUCKET_NAME : undefined;
const R2_PUBLIC_DOMAIN = typeof process !== 'undefined' ? process.env.R2_PUBLIC_DOMAIN : undefined; // 可选：自定义域名

/**
 * 检查 R2 是否已配置
 */
export function isR2Configured(): boolean {
  return !!(
    R2_ACCOUNT_ID &&
    R2_ACCESS_KEY_ID &&
    R2_SECRET_ACCESS_KEY &&
    R2_BUCKET_NAME
  );
}

function assertNodeEnvironment() {
  const inNode = typeof process !== 'undefined' && !!process.versions?.node;

  if (!inNode) {
    throw new Error('R2 上传工具仅在 Node.js 环境下可用，请在 Cloudflare Workers 中改用 R2 KV 绑定。');
  }
}

/**
 * 创建 S3 客户端连接到 R2
 */
async function getR2Client() {
  if (!isR2Configured()) {
    throw new Error('R2 未配置：请设置 R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME');
  }

  assertNodeEnvironment();

  if (!awsSdkModule) {
    awsSdkModule = await import('@aws-sdk/client-s3');
  }

  if (!s3ClientSingleton) {
    const { S3Client } = awsSdkModule;
    s3ClientSingleton = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID!,
        secretAccessKey: R2_SECRET_ACCESS_KEY!,
      },
    });
  }

  return s3ClientSingleton;
}

async function getPutObjectCommand() {
  assertNodeEnvironment();

  if (!awsSdkModule) {
    awsSdkModule = await import('@aws-sdk/client-s3');
  }

  return awsSdkModule.PutObjectCommand;
}

function toBuffer(base64Data: string) {
  assertNodeEnvironment();

  return Buffer.from(base64Data, 'base64');
}

/**
 * 上传图片到 R2
 * @param base64Data Base64 编码的图片数据
 * @param taskId 任务 ID
 * @param index 图片索引
 * @returns 上传结果
 */
export async function uploadToR2(
  base64Data: string,
  taskId: string,
  index: number
): Promise<{
  success: boolean;
  url: string;
  key: string;
  error?: string;
}> {
  try {
    if (!isR2Configured()) {
      return {
        success: false,
        url: '',
        key: '',
        error: 'R2 未配置',
      };
    }

    const s3Client = await getR2Client();
    const PutObjectCommand = await getPutObjectCommand();
    const timestamp = Date.now();
    const key = `images/${taskId}/${timestamp}_${index}.png`;

    // 将 base64 转换为 Buffer
    const imageBuffer = toBuffer(base64Data);

    // 上传到 R2
    await s3Client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET_NAME!,
        Key: key,
        Body: imageBuffer,
        ContentType: 'image/png',
        // 设置为公开可读（如果你的 bucket 允许）
        // ACL: 'public-read', // R2 不支持 ACL，需要通过 bucket 设置
      })
    );

    // 生成公开 URL
    // 方式1: 使用自定义域名（推荐）
    if (R2_PUBLIC_DOMAIN) {
      const publicUrl = `${R2_PUBLIC_DOMAIN}/${key}`;
      return {
        success: true,
        url: publicUrl,
        key,
      };
    }

    // 方式2: 使用 R2.dev 域名（需要在 Cloudflare 控制台启用）
    const r2DevUrl = `https://pub-${R2_ACCOUNT_ID}.r2.dev/${key}`;
    return {
      success: true,
      url: r2DevUrl,
      key,
    };
  } catch (error: any) {
    console.error('R2 上传失败:', error);
    return {
      success: false,
      url: '',
      key: '',
      error: error.message,
    };
  }
}

/**
 * 批量上传图片到 R2
 */
export async function uploadMultipleToR2(
  images: Array<{ base64Data: string; index: number }>,
  taskId: string
): Promise<Array<{
  success: boolean;
  url: string;
  key: string;
  error?: string;
}>> {
  const uploadPromises = images.map(({ base64Data, index }) =>
    uploadToR2(base64Data, taskId, index)
  );

  return Promise.all(uploadPromises);
}
