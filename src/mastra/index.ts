import { Mastra } from '@mastra/core';
import { imageGenerationAgent } from './agents/image-agent';

// 创建Mastra实例
export const mastra = new Mastra({
  agents: {
    imageGenerationAgent,
  },
  server: {
    port: 4111,
    host: '0.0.0.0',
  },
});

export default mastra;