import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// R2 配置
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_DOMAIN = process.env.R2_PUBLIC_DOMAIN; // 可选：自定义域名

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

/**
 * 创建 S3 客户端连接到 R2
 */
function createR2Client() {
  if (!isR2Configured()) {
    throw new Error('R2 未配置：请设置 R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME');
  }

  return new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID!,
      secretAccessKey: R2_SECRET_ACCESS_KEY!,
    },
  });
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
  size?: number;
  error?: string;
}> {
  try {
    if (!isR2Configured()) {
      return {
        success: false,
        url: '',
        key: '',
        size: 0,
        error: 'R2 未配置',
      };
    }

    const s3Client = createR2Client();
    const timestamp = Date.now();
    const key = `images/${taskId}/${timestamp}_${index}.png`;

    // 将 base64 转换为 Buffer
    const imageBuffer = Buffer.from(base64Data, 'base64');
    const size = imageBuffer.length;

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
        size,
      };
    }

    // 方式2: 使用 R2.dev 域名（需要在 Cloudflare 控制台启用）
    const r2DevUrl = `https://pub-${R2_ACCOUNT_ID}.r2.dev/${key}`;
    return {
      success: true,
      url: r2DevUrl,
      key,
      size,
    };
  } catch (error: any) {
    console.error('R2 上传失败:', error);
    return {
      success: false,
      url: '',
      key: '',
      size: 0,
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