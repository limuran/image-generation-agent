/**
 * Cloudflare R2 上传工具
 * 使用 AWS S3 SDK（R2 兼容 S3 API）
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

/**
 * 创建 R2 客户端
 */
function createR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 配置不完整，请检查环境变量');
  }

  // R2 的 endpoint 格式
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;

  return new S3Client({
    region: 'auto',
    endpoint: endpoint,
    credentials: {
      accessKeyId: accessKeyId,
      secretAccessKey: secretAccessKey,
    },
  });
}

/**
 * 生成 R2 存储路径
 */
function generateR2Path(taskId: string, imageIndex: number): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const timestamp = Date.now();
  const randomHash = Math.random().toString(36).substring(2, 8);
  
  return `images/${year}/${month}/${day}/${taskId}_${imageIndex}_${timestamp}_${randomHash}.png`;
}

/**
 * 上传图片到 Cloudflare R2
 */
export async function uploadToR2(
  base64Data: string,
  taskId: string,
  imageIndex: number
): Promise<{ success: boolean; url: string; key: string; error?: string }> {
  try {
    const bucketName = process.env.R2_BUCKET_NAME;
    const publicUrl = process.env.R2_PUBLIC_URL;

    if (!bucketName || !publicUrl) {
      throw new Error('R2_BUCKET_NAME 或 R2_PUBLIC_URL 未配置');
    }

    // 创建 R2 客户端
    const r2Client = createR2Client();

    // 生成存储路径
    const key = generateR2Path(taskId, imageIndex);

    // 转换 base64 为 Buffer
    const imageBuffer = Buffer.from(base64Data, 'base64');

    // 上传到 R2
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: imageBuffer,
      ContentType: 'image/png',
      Metadata: {
        taskId: taskId,
        imageIndex: String(imageIndex),
        uploadedAt: new Date().toISOString(),
      },
    });

    await r2Client.send(command);

    // 生成公开访问 URL
    const finalUrl = `${publicUrl}/${key}`;

    console.log(`☁️  已上传到 R2: ${finalUrl}`);

    return {
      success: true,
      url: finalUrl,
      key: key,
    };
  } catch (error: any) {
    console.error('❌ R2 上传失败:', error.message);
    return {
      success: false,
      url: '',
      key: '',
      error: error.message,
    };
  }
}

/**
 * 检查 R2 是否已配置
 */
export function isR2Configured(): boolean {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME &&
    process.env.R2_PUBLIC_URL
  );
}

export default { uploadToR2, isR2Configured };