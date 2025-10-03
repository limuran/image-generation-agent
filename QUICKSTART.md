# 🚀 快速开始指南

5分钟内让你的图像生成Agent运行起来！

## 📋 准备工作清单

在开始之前，请确保你有：

- [ ] Node.js 18+ 已安装
- [ ] Moonshot Kimi API Key
- [ ] OpenAI API Key (DALL-E 3访问权限)
- [ ] Cloudflare账号

## ⚡ 快速开始

### 1️⃣ 克隆或创建项目

```bash
# 创建项目目录
mkdir image-generation-agent
cd image-generation-agent

# 将所有文件放入此目录
```

### 2️⃣ 安装依赖

```bash
npm install
```

### 3️⃣ 配置环境变量

```bash
# 复制配置模板
cp .env.example .env

# 编辑.env文件
nano .env  # 或使用你喜欢的编辑器
```

必需的配置：

```env
MOONSHOT_API_KEY=sk-xxxxx
OPENAI_API_KEY=sk-xxxxx
```

### 4️⃣ 启动开发服务器

```bash
npm run dev
```

你应该看到：

```
INFO [2025-10-01] (Mastra): Mastra API running on port http://localhost:4111/api
INFO [2025-10-01] (Mastra): 👨‍💻 Playground available at http://localhost:4111/
```

### 5️⃣ 测试API

打开新终端，运行：

```bash
curl -X POST http://localhost:4111/api/generate-image \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "test_001",
    "prompt": "a cute cat playing with yarn",
    "count": 1
  }'
```

如果一切正常，你会收到包含图片URL的JSON响应！

## 🎮 在Playground中测试

1. 访问 <http://localhost:4111/>
2. 选择 "ImageGenerationAgent"
3. 输入提示词，例如：

   ```
   请生成一张图片：一只在路边花丛中奔跑的小狗
   ```

4. 查看Agent如何优化prompt并调用工具生成图片

## 🌐 部署到生产环境

### 第一步：创建R2 Bucket

```bash
# 登录Cloudflare
wrangler login

# 创建存储桶
wrangler r2 bucket create image-agent-storage

# 在Dashboard中设置公开访问
# R2 -> image-agent-storage -> Settings -> Public Access
```

记录下公开URL，例如：`https://pub-xxxxx.r2.dev`

更新`.env`:

```env
R2_PUBLIC_URL=https://pub-xxxxx.r2.dev
```

### 第二步：配置Secrets

```bash
wrangler secret put MOONSHOT_API_KEY
# 输入你的Moonshot API Key

wrangler secret put OPENAI_API_KEY
# 输入你的OpenAI API Key

# 可选：如果要使用Stable Diffusion
wrangler secret put STABILITY_API_KEY
```

### 第三步：部署

```bash
npm run deploy
```

部署成功后，你会得到一个URL：

```
https://image-generation-agent.your-subdomain.workers.dev
```

### 第四步：测试生产环境

```bash
curl -X POST https://image-generation-agent.your-subdomain.workers.dev/api/generate-image \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "prod_test_001",
    "prompt": "sunset over mountains",
    "count": 1
  }'
```

## ⚙️ 配置R2生命周期（30天过期）

```bash
# 创建配置文件
cat > r2-lifecycle.json << 'EOF'
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

## 🎉 完成

你的图像生成Agent现在已经：

- ✅ 在本地运行
- ✅ 部署到Cloudflare
- ✅ 配置了30天自动过期
- ✅ 准备好接收任务

## 📱 接入平台

将以下信息提供给你的Agent平台：

```json
{
  "name": "AI图像生成服务",
  "endpoint": "https://your-worker.workers.dev/api/generate-image",
  "method": "POST",
  "timeout": 90,
  "request_example": {
    "task_id": "task_001",
    "prompt": "a beautiful landscape",
    "count": 3
  }
}
```

## 🐛 遇到问题？

### 本地开发问题

**问题：端口被占用**

```bash
# 修改端口
# 编辑 src/mastra/index.ts
# 将 port: 4111 改为其他端口
```

**问题：API Key无效**

```bash
# 检查.env文件
cat .env

# 确保没有多余空格
MOONSHOT_API_KEY=sk-xxxxx  # ✅
MOONSHOT_API_KEY = sk-xxxxx  # ❌
```

### 部署问题

**问题：R2上传失败**

```bash
# 检查R2配置
wrangler r2 bucket list

# 确保wrangler.toml中的bucket名称正确
```

**问题：Secret未生效**

```bash
# 查看已配置的secrets
wrangler secret list
```

### 性能问题

**问题：生成太慢**

- 单张图片：8-12秒（正常）
- 3张图片：25-35秒（正常）
- 超过60秒：检查网络和API限流

**优化建议：**

- 减少count数量
- 使用standard质量而非hd
- 考虑异步模式

## 📊 监控

### 查看实时日志

```bash
npm run logs
```

### 检查R2使用量

访问 Cloudflare Dashboard -> R2 -> image-agent-storage -> Metrics

### 追踪成本

- DALL-E 3: $0.04/张（standard），$0.08/张（hd）
- Cloudflare: 免费（在额度内）

## 🎯 下一步

1. **优化Prompt**：在Mastra Playground中测试不同的指令
2. **添加更多模型**：集成Midjourney、Leonardo等
3. **实现缓存**：对相同prompt缓存结果
4. **添加认证**：保护API端点
5. **监控告警**：设置Cloudflare Workers告警

## 💡 使用技巧

### 最佳Prompt实践

❌ 不好的prompt：

```
一只狗
```

✅ 好的prompt：

```
a golden retriever puppy running through a field of wildflowers, 
sunset golden hour lighting, bokeh background, professional pet photography, 
4k, high detail, warm tones
```

### 不同场景的建议

**电商产品图：**

- 使用"white background, studio lighting, product photography"
- 选择1024x1024尺寸
- 使用hd质量

**社交媒体：**

- 加入"trendy, modern, instagram style"
- 选择合适的尺寸（1:1或9:16）
- 使用vibrant colors

**艺术创作：**

- 指定艺术风格"watercolor, oil painting, digital art"
- 可以使用stable-diffusion模型
- 实验不同的风格关键词

祝你开发顺利！🚀
