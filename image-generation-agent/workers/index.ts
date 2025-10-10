/**
 * Cloudflare Workers 入口文件
 * 
 * 这是部署到 Cloudflare Workers 的主入口
 */

import './polyfills/dom-parser';

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Handler, MiddlewareHandler } from 'hono';
import type { ApiRoute } from '@mastra/core/server';
import type { Env } from '../src/types';

// 导入路由
import {
  healthRoute,
  generateImageRoute,
  generateBatchRoute,
  taskStatusRoute
} from '../src/api/routes';

const app = new Hono<{ Bindings: Env }>();

type RouteMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'ALL';

const addRouteHandler = (
  target: Hono<{ Bindings: Env }>,
  method: RouteMethod,
  path: string,
  handlers: Handler[]
) => {
  if (handlers.length === 0) {
    return;
  }
  switch (method) {
    case 'GET':
      target.get(path, ...handlers);
      break;
    case 'POST':
      target.post(path, ...handlers);
      break;
    case 'PUT':
      target.put(path, ...handlers);
      break;
    case 'DELETE':
      target.delete(path, ...handlers);
      break;
    case 'PATCH':
      target.patch(path, ...handlers);
      break;
    case 'ALL':
      target.all(path, ...handlers);
      break;
    default:
      target.on(method, path, ...handlers);
  }
};

const registerRoutes = (
  target: Hono<{ Bindings: Env }>,
  prefix: string,
  routes: ApiRoute[]
) => {
  for (const route of routes) {
    const normalizedPath = route.path.startsWith('/')
      ? `${prefix}${route.path}`
      : `${prefix}/${route.path}`;

    const middlewares: MiddlewareHandler[] = Array.isArray(route.middleware)
      ? route.middleware
      : route.middleware
      ? [route.middleware]
      : [];

    if ('handler' in route && route.handler) {
      const handlerStack = [
        ...middlewares.map((mw) => mw as Handler),
        route.handler as Handler,
      ];
      addRouteHandler(target, route.method as RouteMethod, normalizedPath, handlerStack);
    } else if ('createHandler' in route && route.createHandler) {
      const handlerStack = [
        ...middlewares.map((mw) => mw as Handler),
        (async (c, next) => {
          const handler = await route.createHandler({
            mastra: c.get('mastra'),
          });
          return handler(c, next);
        }) as Handler,
      ];
      addRouteHandler(target, route.method as RouteMethod, normalizedPath, handlerStack);
    }
  }
};

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
registerRoutes(app, '/api', [
  healthRoute,
  generateImageRoute,
  generateBatchRoute,
  taskStatusRoute,
]);

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
