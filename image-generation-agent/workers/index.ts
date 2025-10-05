/**
 * Cloudflare Workers 入口文件
 * 
 * 部署到Cloudflare Workers的主入口
 */

import apiRoutes from '../src/api/routes';
import type { ExecutionContext } from '@cloudflare/workers-types';

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    // 设置CORS头
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    
    // 处理OPTIONS预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders,
      });
    }
    
    try {
      // 调用API路由处理
      const response = await apiRoutes.fetch(request, env, ctx);
      
      // 添加CORS头到响应
      const headers = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => {
        headers.set(key, value);
      });
      
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: headers,
      });
    } catch (error: any) {
      console.error('Worker错误:', error);
      
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: error.message || '服务器内部错误',
          },
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        }
      );
    }
  },
};