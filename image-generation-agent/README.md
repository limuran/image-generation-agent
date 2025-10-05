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
