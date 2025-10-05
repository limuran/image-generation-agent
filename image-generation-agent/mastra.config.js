import { Config } from '@mastra/core';

export default {
  name: 'image-generation-agent',
  engine: 'cloudflare',
  agents: './src/mastra/agents',
  tools: './src/mastra/tools',
  integrations: [],
  workflows: [],
  memory: {
    provider: 'in-memory', // Cloudflare Workers使用内存存储
  },
  llms: [
    {
      provider: 'OPENAI',
      name: 'gpt-4o-mini',
      // Moonshot Kimi使用OpenAI兼容配置
      baseURL: 'https://api.moonshot.cn/v1',
    },
  ],
  environment: {
    development: {
      url: 'http://localhost:4111',
      port: 4111,
    },
    production: {
      url: process.env.CLOUDFLARE_WORKERS_URL || 'https://image-generation-agent.workers.dev',
    },
  },
} satisfies Config;