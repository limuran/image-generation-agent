import type { R2Bucket } from '@cloudflare/workers-types';

/**
 * 上传单个图片到 R2
 * @param bucket R2 Bucket 实例
 * @param taskId 任务 ID
 * @param index 图片索引
 * @param base64Data Base64 编码的图片数据（不含前缀）
 * @param publicUrl R2 公开域名
 */
export async function uploadImageToR2(
  bucket: R2Bucket,
  taskId: string,
  index: number,
  base64Data: string,
  publicUrl: string
): Promise<{
  success: boolean;
  url: string;
  key: string;
  fileName: string;
  size: number;
  error?: string;
}> {
  try {
    const timestamp = Date.now();
    const fileName = `${timestamp}_${index}.png`;
    const key = `images/${taskId}/${fileName}`;
    
    // 将 base64 转换为 Uint8Array
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // 上传到 R2
    const result = await bucket.put(key, bytes, {
      httpMetadata: {
        contentType: 'image/png',
        cacheControl: 'public, max-age=31536000', // 1年缓存
      },
      customMetadata: {
        taskId,
        uploadedAt: new Date().toISOString(),
        originalIndex: String(index),
      },
    });
    
    if (!result) {
      throw new Error('R2 上传失败：未返回结果');
    }
    
    // 生成公开 URL
    const fullUrl = `${publicUrl}/${key}`;
    
    console.log(`✅ R2 上传成功: ${key} (${result.size} bytes)`);
    
    return {
      success: true,
      url: fullUrl,
      key,
      fileName,
      size: result.size,
    };
  } catch (error: any) {
    console.error(`❌ R2 上传失败:`, error);
    return {
      success: false,
      url: '',
      key: '',
      fileName: '',
      size: 0,
      error: error.message,
    };
  }
}

/**
 * 批量上传图片到 R2
 * @param bucket R2 Bucket 实例
 * @param taskId 任务 ID
 * @param images 图片数组（data URL 格式）
 * @param publicUrl R2 公开域名
 */
export async function uploadMultipleImages(
  bucket: R2Bucket,
  taskId: string,
  images: Array<{ url: string; revised_prompt?: string }>,
  publicUrl: string
): Promise<Array<{
  index: number;
  url: string;
  storage_key: string;
  file_name: string;
  size_bytes: number;
}>> {
  const results = [];
  
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    
    // 如果是 data URL，提取 base64 数据
    let base64Data = '';
    if (image.url.startsWith('data:')) {
      const matches = image.url.match(/^data:image\/\w+;base64,(.+)$/);
      if (matches && matches[1]) {
        base64Data = matches[1];
      } else {
        console.error(`❌ 无法解析 data URL: ${image.url.substring(0, 50)}...`);
        continue;
      }
    } else {
      console.error(`❌ 不支持的 URL 格式: ${image.url.substring(0, 50)}...`);
      continue;
    }
    
    // 上传到 R2
    const uploadResult = await uploadImageToR2(
      bucket,
      taskId,
      i + 1,
      base64Data,
      publicUrl
    );
    
    if (uploadResult.success) {
      results.push({
        index: i + 1,
        url: uploadResult.url,
        storage_key: uploadResult.key,
        file_name: uploadResult.fileName,
        size_bytes: uploadResult.size,
      });
    }
  }
  
  return results;
}

/**
 * 检查 R2 配置是否正确
 */
export function validateR2Config(
  bucket: R2Bucket | undefined,
  publicUrl: string | undefined
): { valid: boolean; error?: string } {
  if (!bucket) {
    return {
      valid: false,
      error: 'R2 Bucket 未绑定到 Workers 环境',
    };
  }
  
  if (!publicUrl) {
    return {
      valid: false,
      error: 'R2_PUBLIC_URL 环境变量未设置',
    };
  }
  
  return { valid: true };
}