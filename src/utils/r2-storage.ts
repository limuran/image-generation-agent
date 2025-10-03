/**
 * Cloudflare R2 存储工具
 * 用于上传图片并生成公开访问URL
 */

export interface UploadImageOptions {
  taskId: string;
  imageIndex: number;
  imageUrl?: string;
  imageBase64?: string;
}

export interface UploadResult {
  success: boolean;
  url: string;
  key: string;
  error?: string;
}

/**
 * 从URL下载图片
 */
async function downloadImageFromUrl(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.statusText}`);
  }
  return await response.arrayBuffer();
}

/**
 * 从Base64转换为ArrayBuffer
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  // 移除data:image/png;base64,前缀
  const base64Data = base64.replace(/^data:image\/\w+;base64,/, '');
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * 生成存储路径
 * 格式: images/YYYY/MM/DD/taskId_index_timestamp.png
 */
function generateStoragePath(taskId: string, imageIndex: number): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const timestamp = Date.now();
  const randomHash = Math.random().toString(36).substring(2, 8);
  
  return `images/${year}/${month}/${day}/${taskId}_${imageIndex}_${timestamp}_${randomHash}.png`;
}

/**
 * 上传图片到R2
 * 在Cloudflare Workers环境中使用
 */
export async function uploadImageToR2(
  r2Bucket: R2Bucket,
  options: UploadImageOptions
): Promise<UploadResult> {
  try {
    const { taskId, imageIndex, imageUrl, imageBase64 } = options;
    
    // 获取图片数据
    let imageData: ArrayBuffer;
    if (imageUrl) {
      imageData = await downloadImageFromUrl(imageUrl);
    } else if (imageBase64) {
      imageData = base64ToArrayBuffer(imageBase64);
    } else {
      throw new Error('Must provide either imageUrl or imageBase64');
    }
    
    // 生成存储路径
    const key = generateStoragePath(taskId, imageIndex);
    
    // 上传到R2
    await r2Bucket.put(key, imageData, {
      httpMetadata: {
        contentType: 'image/png',
      },
      customMetadata: {
        taskId: taskId,
        imageIndex: String(imageIndex),
        uploadedAt: new Date().toISOString(),
      },
    });
    
    // 生成公开访问URL
    const publicUrl = `${process.env.R2_PUBLIC_URL}/${key}`;
    
    console.log(`✅ 图片上传成功: ${key}`);
    
    return {
      success: true,
      url: publicUrl,
      key: key,
    };
  } catch (error: any) {
    console.error('❌ R2上传失败:', error);
    return {
      success: false,
      url: '',
      key: '',
      error: error.message,
    };
  }
}

/**
 * 批量上传图片
 */
export async function uploadMultipleImages(
  r2Bucket: R2Bucket,
  taskId: string,
  images: Array<{ url?: string; base64?: string }>
): Promise<UploadResult[]> {
  const results: UploadResult[] = [];
  
  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const result = await uploadImageToR2(r2Bucket, {
      taskId,
      imageIndex: i + 1,
      imageUrl: image.url,
      imageBase64: image.base64,
    });
    results.push(result);
  }
  
  return results;
}