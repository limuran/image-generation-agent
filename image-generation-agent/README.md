# 🤖 图像生成Agent

基于 Mastra 框架和 Google Gemini 2.0 Flash Image 的图像生成服务，部署在 Cloudflare Workers 上，可直接供 Next.js 前端通过 `fetch` 或 `axios` 调用。

## ✨ 特性

- 🎨 **智能图像生成**: 使用 Google Gemini 2.0 Flash Image 根据 prompt 生成高质量图像
- 🧠 **AI 增强**: Agent 会优化提示词并指引最佳参数
- ☁️ **云端存储**: 自动上传到 Cloudflare R2，返回公开访问 URL
- 📦 **批量支持**: 一次生成1-5张图片
- ⚡ **边缘计算**: 部署在Cloudflare Workers，全球低延迟

## 🏗️ 技术栈

- **Agent框架**: Mastra
- **AI 模型**: Google Gemini 2.0 Flash
- **图像生成**: Google Gemini 2.0 Flash Image
- **部署平台**: Cloudflare Workers
- **存储**: Cloudflare R2
- **语言**: TypeScript

## 📦 安装

```bash
# 克隆仓库
git clone <your-repo-url>
cd image-generation-agent

# 安装依赖（推荐使用 Yarn 4，或使用 npm 均可）
yarn install

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
# 启动开发服务器（Cloudflare Workers 模式）
yarn dev

# 或使用 Mastra 内置开发体验
yarn dev:mastra

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
# 创建 R2 bucket
yarn deploy:r2

# 配置 secrets
wrangler secret put GOOGLE_API_KEY
wrangler secret put R2_ACCOUNT_ID
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY

# 部署
yarn deploy
```

## 🆚 版本对比（Version 1 vs Version 2）

| 项目 | 版本 1 | 版本 2（当前） |
| --- | --- | --- |
| 路由注册 | 直接在 `workers/index.ts` 上硬编码 `app.route`，与 Mastra `ApiRoute` 类型不完全兼容 | 使用 `registerRoutes` 将 `ApiRoute` 全量映射为 Hono 路径，兼容中间件和动态 handler |
| 运行时依赖 | 缺少 Worker 环境的 DOM 相关对象，某些第三方库在 `wrangler dev` 中报错 | 在 Worker 启动前注入轻量 `DOMParser` polyfill，避免依赖崩溃 |
| 工具初始化 | `smart-image-router` 在模块加载时即要求 `GOOGLE_API_KEY`，本地调试若未设置直接失败 | 改为惰性获取密钥并在首次调用时实例化客户端，便于多环境调试 |
| Agent 提示词 | 输出目录描述固定为本地路径 | 统一提示用户保存位置为工具返回的 R2 URL，匹配实际部署方式 |

> 结论：版本 2 在 Cloudflare Workers 环境稳定性、类型安全以及与 R2 集成的一致性上全面优于版本 1，是推荐使用的版本。

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
