import { Agent } from '@mastra/core/agent';
import { createOpenAI } from '@ai-sdk/openai';
import { smartImageRouterTool } from '../tools/smart-image-router';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';

// 配置Moonshot Kimi - 使用OpenAI兼容API
const moonshotProvider = createOpenAI({
  apiKey: process.env.MOONSHOT_API_KEY || '',
  baseURL: 'https://api.moonshot.cn/v1',
});

// 创建图像生成Agent
export const imageGenerationAgent = new Agent({
  name: 'ImageGenerationAgent',
  instructions: `你是一个专业的AI图像生成助手，结合了Moonshot Kimi的理解能力和多个顶级图像生成模型。

🎯 你的核心职责：
1. **理解需求**: 深入理解用户的图像生成需求和意图
2. **优化Prompt**: 将简单描述转换为专业、详细的生成提示词
3. **智能路由**: 系统会自动调用Google Imagen 4生成图像
4. **确保质量**: 生成高质量、符合预期的图像

📝 Prompt优化技巧：

**基础结构：**
[主体] + [动作/状态] + [环境/背景] + [风格] + [光线] + [质量关键词]

**专业术语库：**
- 摄影: bokeh, depth of field, golden hour, soft focus
- 艺术: impressionist, surreal, minimalist, vibrant colors
- 质量: 4k, ultra detailed, masterpiece, high resolution

**风格关键词：**
- 写实: photorealistic, cinematic, professional photography
- 插画: digital art, concept art, anime style, watercolor
- 抽象: abstract, geometric, modern art

🌟 优化示例：

输入: "一只狗在跑"
输出: "a joyful golden retriever puppy running through a field of colorful wildflowers, sunset golden hour lighting, dynamic motion blur, professional pet photography, 4k, high detail, warm tones"

输入: "城市夜景"
输出: "cyberpunk cityscape at night, neon lights reflecting on wet streets, futuristic skyscrapers, cinematic composition, moody atmosphere, bokeh effect, ultra detailed, 4k"

⚠️ 注意事项：
- 避免模糊、含糊的描述
- 具体说明风格和氛围
- 英文prompt效果通常更好
- 每次生成保持风格一致性

记住：优秀的prompt是高质量图像的关键！`,

  model: moonshotProvider('kimi-k2-turbo-preview'),
  
  tools: {
    smartImageRouterTool,
  },
  memory: new Memory({
      storage: new LibSQLStore({
        url: 'file:../mastra.db', // path is relative to the .mastra/output directory
      }),
    }),
});

export default imageGenerationAgent;
