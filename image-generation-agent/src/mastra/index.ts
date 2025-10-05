
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { weatherWorkflow } from './workflows/weather-workflow';
import { weatherAgent } from './agents/weather-agent';
import { imageGenerationAgent } from './agents/image-agent';
import { routes } from '../api/routes';

export const mastra = new Mastra({
  workflows: { weatherWorkflow },
  agents: { weatherAgent,imageGenerationAgent },
  storage: new LibSQLStore({
    // stores telemetry, evals, ... into memory storage, if it needs to persist, change to file:../mastra.db
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
