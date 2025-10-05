/**
 * 类型定义文件
 */

import type { R2Bucket } from '@cloudflare/workers-types';

/**
 * Cloudflare Workers环境绑定
 */
export interface Env {
  // R2存储桶绑定
  IMAGE_STORAGE: R2Bucket;
  
  // API密钥
  MOONSHOT_API_KEY: string;
  OPENAI_API_KEY: string;
  
  // 环境变量
  NODE_ENV?: string;
  R2_PUBLIC_URL?: string;
}

/**
 * 图像生成请求参数
 */
export interface GenerateImageRequest {
  task_id: string;
  prompt: string;
  count?: number;
  options?: {
    size?: '1024x1024' | '1024x1792' | '1792x1024';
    quality?: 'standard' | 'hd';
  };
}

/**
 * 图像生成响应
 */
export interface GenerateImageResponse {
  success: boolean;
  task_id: string;
  total_images?: number;
  images?: Array<{
    index: number;
    url: string;
    storage_key: string;
  }>;
  generation_time: number;
  expires_at?: string;
  metadata?: {
    prompt: string;
    requested_count: number;
    actual_count: number;
  };
  error?: {
    code: string;
    message: string;
  };
}

/**
 * 生成的图片信息
 */
export interface GeneratedImage {
  url: string;
  model_used: string;
  revised_prompt?: string;
}

/**
 * R2上传结果
 */
export interface UploadResult {
  success: boolean;
  url: string;
  key: string;
  error?: string;
}