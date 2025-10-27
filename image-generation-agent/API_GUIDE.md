# Image Generation Agent API 使用指南

## 📖 目录

- [鉴权机制](#鉴权机制)
- [API 端点](#api-端点)
- [前后端集成示例](#前后端集成示例)
- [错误处理](#错误处理)

---

## 🔐 鉴权机制

### 工作流程

本服务采用 **taskId + secretToken** 的自定义鉴权机制：

```
┌─────────────┐                    ┌──────────────┐
│  前端/调用方 │                    │ Agent 服务    │
└──────┬──────┘                    └──────┬───────┘
       │                                  │
       │ 1. 首次请求                       │
       │ POST /api/generate-image         │
       │ { task_id, prompt }              │
       ├─────────────────────────────────>│
       │                                  │
       │                        2. 生成图片 + secretToken
       │                                  │
       │ 3. 返回结果                       │
       │ { images, secret_token }         │
       │<─────────────────────────────────┤
       │                                  │
       │ 4. 后续请求（需要鉴权）            │
       │ POST /api/generate-image         │
       │ { task_id, secret_token, prompt }│
       ├─────────────────────────────────>│
       │                                  │
       │                        5. 验证 secretToken
       │                           ✅ 匹配 → 处理请求
       │                           ❌ 不匹配 → 403 错误
       │                                  │
       │ 6. 返回结果                       │
       │<─────────────────────────────────┤
```

### 关键点

1. **首次请求**：只需提供 `task_id` 和 `prompt`，服务会生成 `secret_token` 并返回
2. **后续请求**：必须携带 `secret_token` 进行鉴权
3. **Token 存储**：前端需要安全存储 `secret_token`（建议存储在后端数据库）
4. **Token 有效期**：默认 30 天，过期后需要重新生成

---

## 📡 API 端点

### 1. 健康检查

**GET** `/api/health`

检查服务是否正常运行。

**响应示例：**
```json
{
  "status": "ok",
  "service": "image-generation-agent",
  "timestamp": "2025-10-18T10:00:00.000Z",
  "version": "1.0.0"
}
```

---

### 2. 同步图像生成

**POST** `/api/generate-image`

同步生成图像（适合小批量生成，1-5张图片）。

**请求参数：**
```typescript
{
  task_id: string;          // 任务 ID（必需）
  prompt: string;           // 图像描述（必需）
  secret_token?: string;    // 鉴权 Token（首次可选，后续必需）
  count?: number;           // 生成数量 (1-5)，默认 1
  options?: {
    size?: '1024x1024' | '1024x1792' | '1792x1024';  // 默认 1024x1024
    quality?: 'standard' | 'hd';  // 默认 standard
  };
}
```

**响应示例：**
```json
{
  "success": true,
  "task_id": "user_001",
  "secret_token": "a1b2c3d4e5f6...",  // 🔑 首次返回，请妥善保存！
  "total_images": 2,
  "images": [
    {
      "index": 1,
      "url": "https://pub-xxx.r2.dev/images/user_001/1234567890_1.png",
      "storage_key": "images/user_001/1234567890_1.png",
      "file_name": "gemini_1234567890_1.png"
    }
  ],
  "generation_time": 3.45,
  "expires_at": "2025-11-17T10:00:00.000Z",
  "metadata": {
    "prompt": "一只可爱的猫咪",
    "requested_count": 2,
    "actual_count": 2,
    "model_used": "gemini-2.5-flash-image"
  }
}
```

**错误响应：**
```json
{
  "success": false,
  "task_id": "user_001",
  "generation_time": 0.1,
  "error": {
    "code": "INVALID_TOKEN",
    "message": "secret_token 无效"
  }
}
```

---

### 3. 异步图像生成

**POST** `/api/generate-async`

异步生成图像（适合大批量或耗时任务），立即返回 job_id，通过 webhook 回调结果。

**请求参数：**
```typescript
{
  task_id: string;
  prompt: string;
  secret_token?: string;    // 如果 task_id 已存在，必需
  count?: number;
  options?: { ... };
  webhook_url?: string;     // 完成后回调的 URL
}
```

**响应示例：**
```json
{
  "success": true,
  "job_id": "job_1697654321_abc123",
  "task_id": "user_001",
  "status": "pending",
  "message": "任务已加入队列，请通过 /api/job/:jobId 查询状态",
  "query_url": "/api/job/job_1697654321_abc123"
}
```

---

### 4. 查询异步任务状态

**GET** `/api/job/:jobId`

查询异步任务的处理状态。

**响应示例：**
```json
{
  "success": true,
  "job_id": "job_1697654321_abc123",
  "task_id": "user_001",
  "status": "completed",  // pending | processing | completed | failed
  "result": {
    "images": [...],
    "generation_time": 4.2
  },
  "created_at": "2025-10-18T10:00:00.000Z",
  "completed_at": "2025-10-18T10:00:04.200Z"
}
```

---

### 5. 查询任务历史记录

**GET** `/api/task/:taskId?secret_token=xxx`

查询指定任务的所有生成历史（JSON 格式）。

**响应示例：**
```json
{
  "success": true,
  "task_id": "user_001",
  "history": {
    "total_generations": 5,
    "first_generation": "2025-10-01T10:00:00.000Z",
    "last_generation": "2025-10-18T10:00:00.000Z",
    "entries": [
      {
        "prompt": "一只可爱的猫咪",
        "optimized_prompt": "a fluffy orange tabby kitten...",
        "count": 2,
        "images": [...],
        "created_at": "2025-10-18T10:00:00.000Z",
        "expires_at": "2025-11-17T10:00:00.000Z"
      }
    ]
  }
}
```

---

### 6. 导出历史记录为 Markdown

**GET** `/api/task/:taskId/export?secret_token=xxx`

导出任务历史为 Markdown 文件（可下载）。

**响应：**
返回 `text/markdown` 格式的文件，浏览器会自动下载为 `task-{taskId}-history.md`。

---

## 🔗 前后端集成示例

### Next.js 前端示例

```typescript
// lib/imageAgent.ts
import axios from 'axios';

const AGENT_BASE_URL = 'https://your-agent.workers.dev';

export interface GenerateImageParams {
  taskId: string;
  prompt: string;
  secretToken?: string;
  count?: number;
}

export interface GenerateImageResult {
  success: boolean;
  taskId: string;
  secretToken?: string;
  images: Array<{
    index: number;
    url: string;
    fileName: string;
  }>;
  generationTime: number;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * 生成图像
 */
export async function generateImage(params: GenerateImageParams): Promise<GenerateImageResult> {
  try {
    const response = await axios.post(`${AGENT_BASE_URL}/api/generate-image`, {
      task_id: params.taskId,
      prompt: params.prompt,
      secret_token: params.secretToken,
      count: params.count || 1,
    });

    return {
      success: response.data.success,
      taskId: response.data.task_id,
      secretToken: response.data.secret_token,  // 🔑 首次返回，存储到数据库
      images: response.data.images,
      generationTime: response.data.generation_time,
    };
  } catch (error: any) {
    if (error.response?.data) {
      return {
        success: false,
        taskId: params.taskId,
        images: [],
        generationTime: 0,
        error: error.response.data.error,
      };
    }

    throw error;
  }
}

/**
 * 下载任务历史为 Markdown
 */
export function downloadTaskHistory(taskId: string, secretToken: string): void {
  const url = `${AGENT_BASE_URL}/api/task/${taskId}/export?secret_token=${encodeURIComponent(secretToken)}`;

  // 在新窗口打开下载链接
  window.open(url, '_blank');
}
```

### Next.js API Route 示例

```typescript
// app/api/generate-image/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { generateImage } from '@/lib/imageAgent';
import { db } from '@/lib/db';  // 你的数据库

export async function POST(req: NextRequest) {
  const { userId, prompt, count } = await req.json();

  // 从数据库获取用户的 taskId 和 secretToken
  const user = await db.user.findUnique({ where: { id: userId } });

  if (!user.agentTaskId) {
    // 首次生成：使用 userId 作为 taskId
    user.agentTaskId = `user_${userId}`;
  }

  const result = await generateImage({
    taskId: user.agentTaskId,
    prompt,
    secretToken: user.agentSecretToken,  // 后续请求需要
    count,
  });

  if (!result.success) {
    return NextResponse.json(result, { status: 400 });
  }

  // 🔑 如果返回了 secretToken，存储到数据库
  if (result.secretToken && !user.agentSecretToken) {
    await db.user.update({
      where: { id: userId },
      data: {
        agentTaskId: user.agentTaskId,
        agentSecretToken: result.secretToken,
      },
    });
  }

  return NextResponse.json(result);
}
```

### React 组件示例

```typescript
// components/ImageGenerator.tsx
'use client';

import { useState } from 'react';
import { downloadTaskHistory } from '@/lib/imageAgent';

export function ImageGenerator({ userId }: { userId: string }) {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<string[]>([]);

  const handleGenerate = async () => {
    setLoading(true);

    try {
      const response = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, prompt, count: 2 }),
      });

      const result = await response.json();

      if (result.success) {
        setImages(result.images.map((img: any) => img.url));
      } else {
        alert(`错误: ${result.error?.message}`);
      }
    } catch (error) {
      console.error('生成失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadHistory = () => {
    // 需要从后端获取 taskId 和 secretToken
    fetch('/api/user/agent-credentials')
      .then(res => res.json())
      .then(({ taskId, secretToken }) => {
        downloadTaskHistory(taskId, secretToken);
      });
  };

  return (
    <div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="描述你想生成的图片..."
      />
      <button onClick={handleGenerate} disabled={loading}>
        {loading ? '生成中...' : '生成图片'}
      </button>
      <button onClick={handleDownloadHistory}>下载历史记录</button>

      <div className="image-grid">
        {images.map((url, i) => (
          <img key={i} src={url} alt={`Generated ${i + 1}`} />
        ))}
      </div>
    </div>
  );
}
```

---

## ⚠️ 错误处理

### 常见错误码

| 错误码 | 说明 | 解决方案 |
|--------|------|----------|
| `MISSING_PARAMETERS` | 缺少必需参数 | 检查 `task_id` 和 `prompt` 是否提供 |
| `MISSING_SECRET_TOKEN` | taskId 已存在但未提供 secretToken | 从数据库获取并传入 `secret_token` |
| `INVALID_TOKEN` | secretToken 不匹配 | 验证 secretToken 是否正确 |
| `TOKEN_EXPIRED` | secretToken 已过期 | 重新生成（会生成新的 secretToken） |
| `TASK_NOT_FOUND` | 任务不存在 | 首次请求不传 `secret_token` |
| `INVALID_COUNT` | 图片数量超出范围 | count 必须在 1-5 之间 |
| `GENERATION_FAILED` | 图像生成失败 | 查看错误信息，可能是 API 配额问题 |

---

## 🔒 安全建议

1. **存储 secretToken**：
   - ✅ 存储在后端数据库（加密存储）
   - ❌ 不要存储在前端 localStorage 或 cookie

2. **HTTPS**：
   - 生产环境务必使用 HTTPS

3. **速率限制**：
   - 建议在前端/后端实现速率限制

4. **环境变量**：
   - 将 `TASK_SECRET_KEY` 设置为强密钥

---

## 📝 完整请求流程示例

### 场景：用户首次使用

```bash
# 1. 首次请求（无 secretToken）
curl -X POST https://your-agent.workers.dev/api/generate-image \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "user_001",
    "prompt": "一只可爱的猫咪",
    "count": 1
  }'

# 响应（包含 secret_token）
{
  "success": true,
  "task_id": "user_001",
  "secret_token": "a1b2c3d4e5f6...",  # 🔑 保存到数据库
  "images": [...]
}
```

### 场景：用户再次使用

```bash
# 2. 后续请求（需要 secretToken）
curl -X POST https://your-agent.workers.dev/api/generate-image \
  -H "Content-Type": application/json" \
  -d '{
    "task_id": "user_001",
    "secret_token": "a1b2c3d4e5f6...",  # 从数据库获取
    "prompt": "一只可爱的狗狗",
    "count": 2
  }'

# 响应
{
  "success": true,
  "task_id": "user_001",
  "secret_token": "a1b2c3d4e5f6...",  # 相同的 token
  "images": [...]
}
```

### 场景：查询历史记录

```bash
# 3. 查询历史
curl "https://your-agent.workers.dev/api/task/user_001?secret_token=a1b2c3d4e5f6..."

# 4. 下载 Markdown
curl "https://your-agent.workers.dev/api/task/user_001/export?secret_token=a1b2c3d4e5f6..." \
  -o history.md
```

---

## 🚀 快速开始测试

```bash
# 启动本地开发服务器
npm run dev:mastra

# 测试 API
curl -X POST http://localhost:4111/api/generate-image \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "test_001",
    "prompt": "a cute cat in space",
    "count": 1
  }'
```

---

## 📞 支持

如有问题，请查看：
- 项目 README.md
- CLAUDE.md（项目架构说明）
- GitHub Issues

---

**生成时间：** 2025-10-18
**版本：** 1.0.0
