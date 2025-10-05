# 📡 API使用示例

## 基础示例

### 1. 生成单张图片

```bash
curl -X POST http://localhost:4111/api/generate-image \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "task_001",
    "prompt": "A running puppy, with many small flowers by the roadside",
    "count": 1
  }'
```

响应：

```json
{
  "success": true,
  "task_id": "task_001",
  "total_images": 1,
  "images": [
    {
      "index": 1,
      "url": "https://pub-xxx.r2.dev/images/2025/10/01/task_001_1_xxx.png",
      "storage_key": "images/2025/10/01/task_001_1_xxx.png"
    }
  ],
  "generation_time": 8.5,
  "expires_at": "2025-10-31T12:00:00Z",
  "metadata": {
    "prompt": "A running puppy, with many small flowers by the roadside",
    "requested_count": 1,
    "actual_count": 1
  }
}
```

### 2. 生成多张图片

```bash
curl -X POST http://localhost:4111/api/generate-image \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "task_002",
    "prompt": "Cyberpunk city at night, neon lights",
    "count": 3,
    "options": {
      "size": "1024x1792",
      "quality": "hd"
    }
  }'
```

### 3. 指定生成模型

```bash
curl -X POST http://localhost:4111/api/generate-image \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "task_003",
    "prompt": "Abstract geometric art, vibrant colors",
    "count": 2,
    "options": {
      "force_model": "stable-diffusion"
    }
  }'
```

## 高级示例

### 4. 电商产品图

```bash
curl -X POST http://localhost:4111/api/generate-image \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "product_001",
    "prompt": "Modern minimalist coffee mug on white background, studio lighting, product photography, high quality, detailed texture",
    "count": 1,
    "options": {
      "size": "1024x1024",
      "quality": "hd"
    }
  }'
```

### 5. 社交媒体配图

```bash
curl -X POST http://localhost:4111/api/generate-image \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "social_001",
    "prompt": "Inspirational quote background, soft pastel gradient, minimalist design, instagram style, dreamy atmosphere",
    "count": 3,
    "options": {
      "size": "1024x1024",
      "quality": "standard"
    }
  }'
```

### 6. 艺术插画

```bash
curl -X POST http://localhost:4111/api/generate-image \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "art_001",
    "prompt": "Watercolor painting of mountain landscape at sunset, soft colors, artistic style, detailed brush strokes",
    "count": 2,
    "options": {
      "force_model": "stable-diffusion"
    }
  }'
```

## JavaScript/TypeScript 示例

### 7. Node.js

```javascript
const axios = require('axios');

async function generateImage(taskId, prompt, count = 1) {
  try {
    const response = await axios.post('http://localhost:4111/api/generate-image', {
      task_id: taskId,
      prompt: prompt,
      count: count,
    });
    
    console.log('生成成功！');
    console.log('图片URLs:', response.data.images.map(img => img.url));
    
    return response.data;
  } catch (error) {
    console.error('生成失败:', error.response?.data || error.message);
    throw error;
  }
}

// 使用
generateImage('test_001', 'A beautiful sunset over ocean', 2);
```

### 8. TypeScript (完整类型)

```typescript
interface GenerateImageRequest {
  task_id: string;
  prompt: string;
  count?: number;
  options?: {
    size?: '1024x1024' | '1024x1792' | '1792x1024';
    quality?: 'standard' | 'hd';
    force_model?: 'dall-e-3' | 'stable-diffusion' | 'auto';
  };
}

interface GenerateImageResponse {
  success: boolean;
  task_id: string;
  total_images: number;
  images: Array<{
    index: number;
    url: string;
    storage_key: string;
  }>;
  generation_time: number;
  expires_at: string;
  metadata: {
    prompt: string;
    requested_count: number;
    actual_count: number;
  };
}

class ImageGenerationClient {
  constructor(private apiUrl: string) {}
  
  async generate(request: GenerateImageRequest): Promise<GenerateImageResponse> {
    const response = await fetch(`${this.apiUrl}/api/generate-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Generation failed');
    }
    
    return await response.json();
  }
}

// 使用
const client = new ImageGenerationClient('http://localhost:4111');
const result = await client.generate({
  task_id: 'ts_test_001',
  prompt: 'A futuristic robot',
  count: 1,
});
```

### 9. React Hook

```typescript
import { useState } from 'react';

function useImageGeneration(apiUrl: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateImageResponse | null>(null);
  
  const generate = async (prompt: string, count: number = 1) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${apiUrl}/api/generate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_id: `task_${Date.now()}`,
          prompt,
          count,
        }),
      });
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error?.message || 'Generation failed');
      }
      
      setResult(data);
      return data;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };
  
  return { generate, loading, error, result };
}

// 组件中使用
function ImageGenerator() {
  const { generate, loading, result } = useImageGeneration('http://localhost:4111');
  
  const handleGenerate = async () => {
    await generate('A beautiful landscape', 3);
  };
  
  return (
    <div>
      <button onClick={handleGenerate} disabled={loading}>
        {loading ? 'Generating...' : 'Generate Images'}
      </button>
      {result && (
        <div>
          {result.images.map((img) => (
            <img key={img.index} src={img.url} alt={`Generated ${img.index}`} />
          ))}
        </div>
      )}
    </div>
  );
}
```

## 错误处理示例

### 10. 缺少必需参数

请求：

```bash
curl -X POST http://localhost:4111/api/generate-image \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A cat"
  }'
```

响应：

```json
{
  "success": false,
  "error": {
    "code": "MISSING_PARAMETERS",
    "message": "task_id和prompt是必需的参数"
  }
}
```

### 11. 无效的count值

请求：

```bash
curl -X POST http://localhost:4111/api/generate-image \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "test",
    "prompt": "A cat",
    "count": 10
  }'
```

响应：

```json
{
  "success": false,
  "error": {
    "code": "INVALID_COUNT",
    "message": "count必须在1-5之间"
  }
}
```

## 性能优化建议

### 12. 批量生成时使用合理的count

```javascript
// ❌ 不推荐：请求太多次
for (let i = 0; i < 5; i++) {
  await generateImage(`task_${i}`, prompt, 1);
}

// ✅ 推荐：一次请求生成多张
await generateImage('task_batch', prompt, 5);
```

### 13. 错误重试机制

```typescript
async function generateWithRetry(
  request: GenerateImageRequest,
  maxRetries: number = 3
): Promise<GenerateImageResponse> {
  let lastError: Error;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await client.generate(request);
    } catch (error: any) {
      lastError = error;
      console.log(`重试 ${i + 1}/${maxRetries}...`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  
  throw lastError!;
}
```

## 监控和日志

### 14. 记录生成时间

```typescript
const startTime = Date.now();
const result = await client.generate(request);
const totalTime = Date.now() - startTime;

console.log(`总耗时: ${totalTime}ms (API: ${result.generation_time}s)`);
```

### 15. 成本追踪

```typescript
const COST_PER_IMAGE = 0.04; // DALL-E 3标准质量

function calculateCost(imageCount: number): number {
  return imageCount * COST_PER_IMAGE;
}

const result = await client.generate({ /* ... */ });
const cost = calculateCost(result.total_images);
console.log(`本次生成成本: $${cost.toFixed(2)}`);
```
