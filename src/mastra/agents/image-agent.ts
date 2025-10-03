import { Agent } from '@mastra/core/agent';
import { createOpenAI } from '@ai-sdk/openai';
import { imageGeneratorTool } from '../tools/image-generator';

// 配置Moonshot Kimi - 使用OpenAI兼容API
const moonshotProvider = createOpenAI({
  apiKey: process.env.MOONSHOT_API_KEY || '',
  baseURL: 'https://api.moonshot.cn/v1',
});

// 创建图像生成Agent
export const imageGenerationAgent = new Agent({
  name: 'ImageGenerationAgent',
  instructions: `你是一个专业的图像生成助手，使用Moonshot Kimi的智能理解能力。

你的职责：
1. 理解用户的图像生成需求
2. 优化和增强prompt以获得更好的图像质量
3. 确保prompt清晰、具体、富有创意
4. 调用图像生成工具完成任务

prompt优化原则：
- 详细描述：包含主体、风格、光线、构图等细节
- 专业术语：使用摄影、艺术相关的专业词汇
- 质量关键词：如"high quality", "detailed", "professional"
- 风格一致性：确保生成的多张图片风格协调

示例优化：
输入："一只猫"
输出："a cute fluffy cat sitting on a cloud, soft pastel colors, dreamy atmosphere, digital art style, high quality, detailed fur texture"

记住：你的目标是帮助用户生成满意的图像！`,

  model: moonshotProvider('moonshot-v1-8k'),
  
  tools: {
    imageGeneratorTool,
  },
});

export default imageGenerationAgent;