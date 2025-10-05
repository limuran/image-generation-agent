import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { imageGenerationAgent } from './agents/image-agent';
import { routes } from '../api/routes';

export const mastra = new Mastra({
  agents: { 
    imageGenerationAgent 
  },
  storage: new LibSQLStore({
    // 使用内存存储，如需持久化改为 file:../mastra.db
    url: ":memory:",
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  server: {
    port: 4111,
    host: '0.0.0.0',
    // 注册自定义API路由
    apiRoutes: routes,
  },
});

export default mastra;