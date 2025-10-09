/**
 * Cloudflare Workers 入口文件
 * 
 * 这是部署到 Cloudflare Workers 的主入口
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from '../src/types';

// 导入路由
import { 
  healthRoute, 
  generateImageRoute, 
  generateBatchRoute,
  taskStatusRoute 
} from '../src/api/routes';

const app = new Hono<{ Bindings: Env }>();

// 配置 CORS
app.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Length'],
  maxAge: 600,
  credentials: false,
}));

// 注册路由
app.route('/api', healthRoute);
app.route('/api', generateImageRoute);
app.route('/api', generateBatchRoute);
app.route('/api', taskStatusRoute);

// 根路径
app.get('/', (c) => {
  return c.json({
    service: 'image-generation-agent',
    version: '1.0.0',
    status: 'running',
    endpoints: [
      'GET  /api/health',
      'POST /api/generate-image',
      'POST /api/generate-batch',
      'GET  /api/task/:taskId',
    ],
    documentation: 'https://github.com/your-repo/image-generation-agent',
  });
});

// 404 处理
app.notFound((c) => {
  return c.json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: '请求的路径不存在',
      path: c.req.path,
    },
  }, 404);
});

// 错误处理
app.onError((err, c) => {
  console.error('💥 Worker 错误:', err);
  
  return c.json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: err.message || '服务器内部错误',
    },
  }, 500);
});

// 导出 Workers 处理器
export default app;