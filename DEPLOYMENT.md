# 🚀 部署指南

## 📋 前置准备

### 1. 获取API密钥

#### Moonshot Kimi

1. 访问 <https://platform.moonshot.cn/>
2. 注册账号
3. 获取API Key

#### OpenAI (DALL-E 3)

1. 访问 <https://platform.openai.com/>
2. 创建API Key
3. 确保账户有DALL-E 3访问权限

#### Stability AI (可选)

1. 访问 <https://platform.stability.ai/>
2. 注册并获取API Key
3. 用于Stable Diffusion模型

### 2. Cloudflare配置

#### 创建R2 Bucket

```bash
# 登录Cloudflare
wrangler login

# 创建R2 bucket
wrangler r2 bucket create image-agent-storage

# 设置公开访问
# 在Cloudflare Dashboard -> R2 -> image-agent-storage -> Settings
# 启用"Public Access"并记录公开URL
```

## 🔧 本地开发

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
# 复制配置文件
cp .env.example .env

# 编辑.env文件，填入你的API密钥
```

### 3. 启动开发服务器

```bash
npm run dev
```

访问 <http://localhost:4111> 测试Agent

### 4. 测试API

```bash
curl -X POST http://localhost:4111/api/generate-image \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "test_001",
    "prompt": "A running puppy, with many small flowers by the roadside",
    "count": 1,
    "options": {
      "size": "1024x1024",
      "quality": "standard"
    }
  }'
```

## ☁️ 部署到Cloudflare Workers

### 1. 配置Secrets

```bash
# 添加Moonshot API Key
wrangler secret put MOONSHOT_API_KEY

# 添加OpenAI API Key
wrangler secret put OPENAI_API_KEY

# 添加Stability AI Key (可选)
wrangler secret put STABILITY_API_KEY
```

### 2. 配置R2绑定

确保`wrangler.toml`中的R2配置正确：

```toml
[[r2_buckets]]
binding = "IMAGE_STORAGE"
bucket_name = "image-agent-storage"
```

### 3. 部署

```bash
# 测试构建
npm run build

# 部署到生产环境
npm run deploy
```

### 4. 验证部署

```bash
# 替换为你的Workers URL
curl https://your-worker.your-subdomain.workers.dev/health

# 测试图像生成
curl -X POST https://your-worker.your-subdomain.workers.dev/api/generate-image \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "prod_test_001",
    "prompt": "A cute cat in cyberpunk style",
    "count": 1
  }'
```

## 🔄 配置R2生命周期规则（30天自动过期）

### 方法1: 通过Cloudflare Dashboard

1. 进入 Cloudflare Dashboard
2. 选择 R2 -> image-agent-storage
3. 点击 Settings -> Lifecycle Rules
4. 添加规则：
   - Name: "30-day-expiration"
   - Prefix: "images/"
   - Days after creation: 30
   - Action: Delete

### 方法2: 通过Wrangler CLI

```bash
# 创建lifecycle配置文件
cat > r2-lifecycle.json << EOF
{
  "rules": [
    {
      "id": "delete-after-30-days",
      "status": "Enabled",
      "filter": {
        "prefix": "images/"
      },
      "expiration": {
        "days": 30
      }
    }
  ]
}
EOF

# 应用配置
wrangler r2 bucket lifecycle put image-agent-storage --rules r2-lifecycle.json
```

## 🔍 监控和日志

### 查看Workers日志

```bash
# 实时查看日志
wrangler tail

# 查看特定Worker的日志
wrangler tail --name image-generation-agent
```

### 监控指标

在Cloudflare Dashboard中可以查看：

- 请求数量
- 错误率
- CPU使用时间
- R2存储使用量

## 🐛 故障排查

### 常见问题

#### 1. CORS错误

确保Workers返回了正确的CORS头，已在`src/workers/index.ts`中配置

#### 2. R2上传失败

检查：

- R2 Bucket是否创建成功
- wrangler.toml中的binding配置是否正确
- 图片大小是否超过限制（R2单个对象限制5TB）

#### 3. API Key错误

```bash
# 验证secrets是否正确设置
wrangler secret list
```

#### 4. 超时问题

Cloudflare Workers有CPU时间限制：

- 免费版: 10ms
- 付费版: 50ms-30s

生成多张图片可能需要较长时间，建议：

- 减少count数量
- 使用异步模式（需要webhook回调）

## 📊 成本估算

### Cloudflare费用

- **Workers**: 免费10万次请求/天
- **R2存储**: 免费10GB + 100万次A类操作
- **带宽**: R2出站流量免费

### API费用

- **DALL-E 3**:
  - 标准质量: $0.040/张 (1024x1024)
  - HD质量: $0.080/张
- **Moonshot Kimi**: 按token计费
- **Stability AI**: 约$0.002-0.01/张

### 示例成本（每月）

假设每天处理100个任务，每个任务3张图：

- DALL-E 3: 100 × 3 × 30 × $0.04 = $360/月
- Cloudflare: 免费（在免费额度内）
- 总计: 约$360-400/月

## 🔐 安全建议

1. **API Key保护**:
   - 不要提交.env文件到Git
   - 使用wrangler secrets存储密钥

2. **请求限流**:
   - 添加rate limiting防止滥用
   - 考虑添加认证机制

3. **输入验证**:
   - 验证prompt长度
   - 过滤敏感内容
   - 限制count范围

## 🚦 生产环境检查清单

部署前确认：

- [ ] 所有API Keys已配置
- [ ] R2 Bucket已创建并配置公开访问
- [ ] R2生命周期规则已设置（30天过期）
- [ ] wrangler.toml配置正确
- [ ] 本地测试通过
- [ ] 设置了错误监控和告警
- [ ] 准备好成本预算
- [ ] 制定了扩展计划

## 📱 接入Agent平台

当你的Agent部署完成后，将以下信息提供给平台：

```json
{
  "service_name": "AI图像生成服务",
  "api_endpoint": "https://your-worker.workers.dev/api/generate-image",
  "method": "POST",
  "request_schema": {
    "task_id": "string (必需)",
    "prompt": "string (必需)",
    "count": "number (1-5, 可选)",
    "options": {
      "size": "string (可选)",
      "quality": "string (可选)"
    }
  },
  "response_schema": {
    "success": "boolean",
    "task_id": "string",
    "images": "array",
    "generation_time": "number"
  },
  "timeout": "90秒",
  "cost_per_request": "$0.12-0.36"
}
```

## 🎉 完成

你的图像生成Agent现在已经可以接单工作了！
