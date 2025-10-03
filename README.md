# 🤖 图像生成Agent

基于Mastra框架和Moonshot Kimi模型的图像生成服务，部署在Cloudflare Workers上。

## ✨ 特性

- 🎨 **智能图像生成**: 使用DALL-E 3根据prompt生成高质量图像
- 🧠 **AI增强**: 通过Moonshot Kimi优化和理解prompt
- ☁️ **云端存储**: 自动上传到Cloudflare R2，返回公开访问URL
- 📦 **批量支持**: 一次生成1-5张图片
- ⚡ **边缘计算**: 部署在Cloudflare Workers，全球低延迟

## 🏗️ 技术栈

- **Agent框架**: Mastra
- **AI模型**: Moonshot Kimi (kimi-k2-turbo-preview)
- **图像生成**: OpenAI DALL-E 3
- **部署平台**: Cloudflare Workers
- **存储**: Cloudflare R2
- **语言**: TypeScript

## 📦 安装

```bash
# 克隆仓库
git clone <your-repo-url>
cd image-generation-agent

# 安装依赖
npm install

# 复制环境变量配置
cp .env.example .env

# 编辑.env文件，填入你的API密钥
```

## 🔑 配置

1. **Moonshot API Key**:
   - 访问 <https://platform.moonshot.cn/>
   - 注册并获取API Key

2. **OpenAI API Key**:
   - 访问 <https://platform.openai.com/>
   - 获取API Key用于DALL-E 3

3. **Cloudflare R2**:
   - 创建R2 bucket
   - 获取Account ID和Access Keys

## 🚀 本地开发

```bash
# 启动开发服务器
npm run dev

# 访问 http://localhost:4111
# 在Playground中测试你的Agent
```

## 📡 API使用

### 生成图像

```bash
POST /api/generate-image

# 请求体
{
  "task_id": "task_001",
  "prompt": "a cute cat sitting on a cloud, digital art style",
  "count": 3,
  "options": {
    "size": "1024x1024",
    "quality": "standard"
  }
}

# 响应
{
  "success": true,
  "task_id": "task_001",
  "total_images": 3,
  "images": [
    {
      "index": 1,
      "url": "https://pub-xxx.r2.dev/images/task_001_1.png"
    },
    {
      "index": 2,
      "url": "https://pub-xxx.r2.dev/images/task_001_2.png"
    },
    {
      "index": 3,
      "url": "https://pub-xxx.r2.dev/images/task_001_3.png"
    }
  ],
  "generation_time": 25.3
}
```

## 🌐 部署到Cloudflare

```bash
# 创建R2 bucket
npm run deploy:r2

# 配置secrets
wrangler secret put MOONSHOT_API_KEY
wrangler secret put OPENAI_API_KEY

# 部署
npm run deploy
```

## 📂 项目结构

```
image-generation-agent/
├── src/
│   ├── mastra/
│   │   ├── agents/
│   │   │   └── image-agent.ts      # 图像生成Agent
│   │   ├── tools/
│   │   │   └── image-generator.ts  # 图像生成工具
│   │   └── index.ts                # Mastra配置
│   ├── api/
│   │   └── routes.ts               # API路由
│   └── workers/
│       └── index.ts                # Cloudflare Workers入口
├── package.json
├── tsconfig.json
├── wrangler.toml
└── .env.example
```

## 🤝 贡献

欢迎提交Issues和Pull Requests！

## 📄 许可证

MIT License

# 🚀 图像生成Agent - 设置指南

## ✅ 已完成的文件

我已经为你创建了以下核心文件：

### 1. 配置文件

- ✅ `package.json` - 项目依赖和脚本
- ✅ `tsconfig.json` - TypeScript配置
- ✅ `wrangler.toml` - Cloudflare Workers配置
- ✅ `.env.example` - 环境变量模板
- ✅ `README.md` - 项目文档

### 2. 核心代码

- ✅ `src/mastra/index.ts` - Mastra主配置
- ✅ `src/mastra/agents/image-agent.ts` - Moonshot Kimi Agent
- ✅ `src/mastra/tools/image-generator.ts` - 图像生成工具

## 📋 接下来需要创建的文件

### 1. API路由 (src/api/routes.ts)

处理外部平台的请求，上传图片到R2，返回URL

### 2. Cloudflare Workers入口 (src/workers/index.ts)  

Workers的主入口文件，集成所有功能

### 3. R2存储助手 (src/utils/r2-storage.ts)

封装R2上传和URL生成逻辑

## 🎯 下一步操作

你需要：

1. **创建GitHub仓库**

   ```bash
   git init
   git add .
   git commit -m "初始化项目"
   git remote add origin <your-repo-url>
   git push -u origin main
   ```

2. **安装依赖**

   ```bash
   npm install
   ```

3. **配置环境变量**
   - 复制 `.env.example` 到 `.env`
   - 填入你的API密钥

4. **本地测试**

   ```bash
   npm run dev
   ```

## 🤔 关键问题

在继续之前，请确认：

1. ✅ **Moonshot Kimi API**: 你已经有API Key了吗？
2. ✅ **OpenAI API**: 你有DALL-E 3的访问权限吗？
3. ❓ **图像存储**:
   - 使用Cloudflare R2 (推荐，免费额度大)
   - 还是AWS S3？
4. ❓ **多图生成策略**:
   - 串行生成（稳定但慢）
   - 并行生成（快但可能超限）

请告诉我你的选择，我会继续完善剩余的代码！
