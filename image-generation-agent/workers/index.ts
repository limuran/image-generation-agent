/**
 * Cloudflare Workers 入口文件
 * - 注入环境变量供 Mastra / 工具使用
 * - 注册 Mastra API 路由
 * - 提供异步图片生成 + Webhook 回调能力
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from '../src/types';
import { createMastra } from '../src/mastra/index';
import { routes as mastraRoutes } from '../src/api/routes';

type RegisteredRoute = {
  method?: string;
  path: string;
  handler: (...args: any[]) => unknown;
};

const BOUND_SECRET_KEYS: Array<keyof Env> = [
  'GOOGLE_API_KEY',
  'MOONSHOT_API_KEY',
  'OPENAI_API_KEY',
];

const app = new Hono<{ Bindings: Env }>();

app.use(
  '/*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Length', 'Content-Disposition'],
    maxAge: 600,
    credentials: false,
  }),
);

function injectGlobalEnv(env: Env) {
  if (typeof globalThis !== 'undefined') {
    (globalThis as Record<string, unknown>).ENV = {
      GOOGLE_API_KEY: env.GOOGLE_API_KEY,
      MOONSHOT_API_KEY: env.MOONSHOT_API_KEY,
      OPENAI_API_KEY: env.OPENAI_API_KEY,
      R2_PUBLIC_URL: env.R2_PUBLIC_URL,
      NODE_ENV: env.NODE_ENV,
    };

    BOUND_SECRET_KEYS.forEach((key) => {
      const value = env[key];
      if (typeof value === 'string' && value.length > 0) {
        (globalThis as Record<string, unknown>)[key] = value;
      }
    });

    // 关闭 Mastra 遥测警告
    (globalThis as Record<string, unknown>).___MASTRA_TELEMETRY___ = true;
  }

  if (typeof process !== 'undefined' && process.env) {
    const nodeEnv = process.env as Record<string, string | undefined>;

    BOUND_SECRET_KEYS.forEach((key) => {
      const value = env[key];
      if (typeof value === 'string' && value.length > 0) {
        nodeEnv[key] = value;
      }
    });

    if (env.NODE_ENV) {
      nodeEnv.NODE_ENV = env.NODE_ENV;
    }
  }
}

let mastraInstance: ReturnType<typeof createMastra> | null = null;
let mastraRoutesRegistered = false;

function normalizeRoutePath(path: string): string {
  if (path.startsWith('/api')) {
    return path;
  }
  return path.startsWith('/') ? `/api${path}` : `/api/${path}`;
}

function bindRoute(route: RegisteredRoute, source: string) {
  if (!route.path || !route.method || typeof route.handler !== 'function') {
    console.warn(`⚠️  [Workers] 跳过非法 ${source} 路由配置:`, route);
    return;
  }

  const path = normalizeRoutePath(route.path);
  const method = route.method.toLowerCase();

  console.log(`📍 [Workers] 注册 ${source} 路由: ${method.toUpperCase()} ${path}`);

  switch (method) {
    case 'get':
      app.get(path, route.handler);
      break;
    case 'post':
      app.post(path, route.handler);
      break;
    case 'put':
      app.put(path, route.handler);
      break;
    case 'delete':
      app.delete(path, route.handler);
      break;
    case 'options':
      app.options(path, route.handler);
      break;
    default:
      console.warn(`⚠️  [Workers] 未知的 Mastra 路由方法: ${route.method}`);
  }
}

function registerMastraRoutes(mastra: ReturnType<typeof createMastra>) {
  const alreadyRegistered = new Set<string>();
  const apiRoutes = mastra.server?.apiRoutes ?? [];

  console.log(`📚 [Workers] Mastra server 提供 ${apiRoutes.length} 条路由`);

  apiRoutes.forEach((routeConfig) => {
    const route = routeConfig as RegisteredRoute;
    const key = `${(route.method ?? '').toLowerCase()}::${normalizeRoutePath(route.path)}`;
    if (alreadyRegistered.has(key)) {
      return;
    }

    bindRoute(route, 'Mastra');
    alreadyRegistered.add(key);
  });

  mastraRoutes.forEach((routeConfig) => {
    const route = routeConfig as RegisteredRoute;
    const key = `${(route.method ?? '').toLowerCase()}::${normalizeRoutePath(route.path)}`;
    if (alreadyRegistered.has(key)) {
      return;
    }
    bindRoute(route, 'fallback');
    alreadyRegistered.add(key);
  });
}

function ensureMastra(env: Env) {
  if (!mastraInstance) {
    console.log('🚀 [Workers] 初始化 Mastra 实例');
    mastraInstance = createMastra({ enableAsyncProcessor: false });
  }

  if (!mastraRoutesRegistered && mastraInstance) {
    registerMastraRoutes(mastraInstance);
    mastraRoutesRegistered = true;
  }
}

app.get('/', (c) => {
  return c.json({
    service: 'image-generation-agent',
    version: '2.2.0',
    status: 'running',
    mode: 'cloudflare-workers',
    endpoints: '参见 /api/* Mastra 自动注册的路由',
  });
});

app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'image-generation-agent',
  });
});

app.notFound((c) => {
  return c.json(
    {
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: '请求的路径不存在',
        path: c.req.path,
      },
    },
    404,
  );
});

app.onError((err, c) => {
  console.error('💥 Worker 错误:', err);
  return c.json(
    {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: err?.message ?? '服务器内部错误',
      },
    },
    500,
  );
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    injectGlobalEnv(env);
    ensureMastra(env);
    return app.fetch(request, env, ctx);
  },
};
