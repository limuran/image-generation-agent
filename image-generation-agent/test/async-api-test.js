/**
 * 异步任务 API 全链路测试脚本 + 本地 Webhook 服务
 *
 * 完整测试链路:
 * 1. Token 创建和校验
 * 2. 异步图片生成
 * 3. Webhook 回调接收
 * 4. D1 数据库验证
 * 5. 导出 Markdown 历史
 *
 * 用法:
 *   npm run test:async              # 运行完整测试
 *   npm run test:webhook            # 仅启动 webhook 服务
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ES modules 中获取 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 配置
const DEFAULT_WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT || '3999', 10);
const DEFAULT_WEBHOOK_HOST = process.env.WEBHOOK_HOST || 'localhost';
const DEFAULT_WEBHOOK_PROTOCOL = process.env.WEBHOOK_PROTOCOL || 'http';
const LOCAL_WEBHOOK_BASE = `${DEFAULT_WEBHOOK_PROTOCOL}://${DEFAULT_WEBHOOK_HOST}:${DEFAULT_WEBHOOK_PORT}`;
const WEBHOOK_PORT = DEFAULT_WEBHOOK_PORT;
const API_URL = process.env.API_URL || 'http://localhost:4111/api'; // mastra dev
// const API_URL = process.env.API_URL || 'http://localhost:8787/api'; // workers dev
const WEBHOOK_URL = process.env.WEBHOOK_URL || `${LOCAL_WEBHOOK_BASE}/webhook`;
const WEBHOOK_STATUS_BASE = process.env.WEBHOOK_INTERNAL_BASE || LOCAL_WEBHOOK_BASE;
const SKIP_INTERNAL_WEBHOOK = process.env.SKIP_INTERNAL_WEBHOOK === 'true';

// 存储接收到的 webhook 回调
const receivedWebhooks = [];
let currentSecretToken = null;
let testTaskId = null;

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function log(type, message) {
  const prefix = {
    info: `${colors.cyan}ℹ${colors.reset}`,
    success: `${colors.green}✅${colors.reset}`,
    error: `${colors.red}❌${colors.reset}`,
    warning: `${colors.yellow}⚠️${colors.reset}`,
    webhook: `${colors.magenta}📡${colors.reset}`,
    step: `${colors.bright}🔍${colors.reset}`,
    db: `${colors.green}💾${colors.reset}`,
  };
  const timestamp = new Date().toLocaleTimeString('zh-CN');
  console.log(`[${timestamp}] ${prefix[type] || ''} ${message}`);
}

/**
 * 创建本地 Webhook 服务
 */
function createWebhookServer() {
  const server = http.createServer((req, res) => {
    // 处理 CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Webhook 回调端点
    if (req.url === '/webhook' && req.method === 'POST') {
      let body = '';

      req.on('data', chunk => {
        body += chunk.toString();
      });

      req.on('end', () => {
        try {
          const data = JSON.parse(body);

          log('webhook', `收到 Webhook 回调！`);
          log('info', `  Job ID: ${data.job_id}`);
          log('info', `  Task ID: ${data.task_id}`);
          log('info', `  状态: ${data.status}`);

          if (data.status === 'completed') {
            log('success', `  生成成功！图片数量: ${data.result?.images?.length || 0}`);
            if (data.generation_time) {
              log('info', `  耗时: ${data.generation_time}s`);
            }
          } else if (data.status === 'failed') {
            log('error', `  生成失败: ${data.error?.message}`);
          }

          // 保存回调数据
          receivedWebhooks.push({
            timestamp: new Date().toISOString(),
            data,
          });

          // 返回成功响应
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, received: true }));

          // 输出详细数据
          console.log('\n' + '─'.repeat(70));
          console.log('Webhook 回调详细数据:');
          console.log(JSON.stringify(data, null, 2));
          console.log('─'.repeat(70) + '\n');
        } catch (error) {
          log('error', `解析 Webhook 数据失败: ${error.message}`);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });

      return;
    }

    // 健康检查端点
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        service: 'webhook-test-server',
        webhooks_received: receivedWebhooks.length,
      }));
      return;
    }

    // 查看已接收的 webhooks
    if (req.url === '/webhooks' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        total: receivedWebhooks.length,
        webhooks: receivedWebhooks,
      }));
      return;
    }

    // 404
    res.writeHead(404);
    res.end('Not Found');
  });

  return server;
}

async function fetchWebhookSnapshot() {
  if (!SKIP_INTERNAL_WEBHOOK) {
    return {
      total: receivedWebhooks.length,
      webhooks: [...receivedWebhooks],
    };
  }

  try {
    const response = await fetch(`${WEBHOOK_STATUS_BASE}/webhooks`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    return {
      total: data.total ?? (Array.isArray(data.webhooks) ? data.webhooks.length : 0),
      webhooks: Array.isArray(data.webhooks) ? data.webhooks : [],
    };
  } catch (error) {
    log('warning', `获取外部 Webhook 状态失败: ${error.message}`);
    return { total: 0, webhooks: [] };
  }
}

async function checkExternalWebhookHealth() {
  try {
    const response = await fetch(`${WEBHOOK_STATUS_BASE}/health`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    if (data?.status === 'ok') {
      log('success', `外部 Webhook 服务可用: ${WEBHOOK_STATUS_BASE}`);
      return true;
    }
    log('warning', '外部 Webhook 服务健康检查返回异常状态');
    return false;
  } catch (error) {
    log('warning', `外部 Webhook 服务不可达: ${error.message}`);
    return false;
  }
}

/**
 * 测试 1: 创建 Token
 */
async function testCreateToken() {
  log('step', '测试 1: 创建 Token');

  testTaskId = `async_test_${Date.now()}`;

  try {
    const response = await fetch(`${API_URL}/create-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: testTaskId }),
    });

    const data = await response.json();

    if (!data.success || !data.secret_token) {
      log('error', `创建 secret_token 失败: ${data.error?.message || '未知错误'}`);
      return { success: false };
    }

    currentSecretToken = data.secret_token;
    log('success', `Token 创建成功`);
    log('info', `  Task ID: ${testTaskId}`);
    log('info', `  Secret Token: ${data.secret_token.substring(0, 20)}...`);
    return { success: true, taskId: testTaskId, secretToken: data.secret_token };
  } catch (error) {
    log('error', `创建 secret_token 失败: ${error.message}`);
    log('warning', `提示: 确保 API 服务正在运行 (${API_URL})`);
    return { success: false };
  }
}

/**
 * 测试 2: 提交异步任务
 */
async function testAsyncTaskSubmission() {
  log('step', '测试 2: 提交异步任务');

  if (!currentSecretToken || !testTaskId) {
    log('error', '跳过测试: 没有可用的 token 或 task_id');
    return { success: false };
  }

  try {
    const response = await fetch(`${API_URL}/generate-async`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: testTaskId,
        secret_token: currentSecretToken,
        prompt: 'a beautiful sunset over mountains and a peaceful lake',
        count: 2,
        webhook_url: WEBHOOK_URL,
        options: {
          size: '1024x1024',
          quality: 'standard',
        },
      }),
    });

    const data = await response.json();

    if (data.success) {
      log('success', `异步任务提交成功`);
      log('info', `  Job ID: ${data.job_id}`);
      log('info', `  Task ID: ${data.task_id}`);
      log('info', `  状态: ${data.status}`);
      log('info', `  Webhook URL: ${WEBHOOK_URL}`);
      if (data.secret_token) {
        currentSecretToken = data.secret_token;
        log('info', `  轮换后 secret_token: ${data.secret_token.substring(0, 20)}...`);
      }
      return { success: true, jobId: data.job_id, taskId: data.task_id };
    } else {
      log('error', `异步任务提交失败: ${data.error?.message || '未知错误'}`);
      console.log('响应数据:', JSON.stringify(data, null, 2));
      return { success: false };
    }
  } catch (error) {
    log('error', `请求失败: ${error.message}`);
    return { success: false };
  }
}

/**
 * 测试 3: 查询任务状态
 */
async function testTaskStatus(jobId) {
  log('step', '测试 3: 查询任务状态');

  if (!jobId) {
    log('warning', '跳过测试: 没有可用的 Job ID');
    return false;
  }

  try {
    const response = await fetch(`${API_URL}/job/${jobId}`, {
      method: 'GET',
    });

    const data = await response.json();

    if (data.success) {
      log('success', `任务状态查询成功`);
      log('info', `  Job ID: ${data.job_id}`);
      log('info', `  状态: ${data.status}`);
      log('info', `  创建时间: ${data.created_at}`);

      if (data.status === 'completed' && data.result) {
        log('info', `  生成图片数: ${data.result.images?.length || 0}`);
      }

      return true;
    } else {
      log('error', `任务状态查询失败: ${data.error?.message || '未知错误'}`);
      return false;
    }
  } catch (error) {
    log('error', `查询失败: ${error.message}`);
    return false;
  }
}

/**
 * 测试 4: 等待 Webhook 回调
 */
async function waitForWebhook(jobId, timeoutSeconds = 120) {
  log('step', '测试 4: 等待 Webhook 回调');
  log('info', `  最长等待时间: ${timeoutSeconds}s`);

  const startTime = Date.now();
  const seenSignatures = new Set();

  const registerExisting = (entries) => {
    entries.forEach(entry => {
      if (entry?.timestamp) {
        seenSignatures.add(entry.timestamp);
      } else if (entry?.data?.job_id) {
        const signature = `${entry.data.job_id}:${entry.data.status ?? 'unknown'}:${entry.data.updated_at ?? ''}`;
        seenSignatures.add(signature);
      }
    });
  };

  const initialSnapshot = await fetchWebhookSnapshot();
  registerExisting(initialSnapshot.webhooks);

  while (true) {
    const elapsed = (Date.now() - startTime) / 1000;

    if (elapsed >= timeoutSeconds) {
      log('warning', `等待超时 (${timeoutSeconds}s)，未收到 Webhook 回调`);
      return { success: false, timeout: true };
    }

    const snapshot = await fetchWebhookSnapshot();

    for (const entry of snapshot.webhooks) {
      const signature = entry?.timestamp
        ? entry.timestamp
        : `${entry?.data?.job_id}:${entry?.data?.status ?? 'unknown'}:${entry?.data?.updated_at ?? ''}`;

      if (!seenSignatures.has(signature)) {
        seenSignatures.add(signature);

        if (entry?.data?.job_id === jobId) {
          log('success', `收到 Webhook 回调！耗时: ${elapsed.toFixed(1)}s`);
          return { success: true, webhook: entry.data };
        }
      }
    }

    if (Math.floor(elapsed) % 10 === 0 && elapsed > 0) {
      log('info', `  等待中... ${elapsed.toFixed(0)}s / ${timeoutSeconds}s`);
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

/**
 * 测试 5: 查询数据库历史记录
 */
async function testDatabaseHistory() {
  log('step', '测试 5: 查询数据库历史记录（D1）');

  if (!testTaskId || !currentSecretToken) {
    log('warning', '跳过测试: 没有可用的 task_id 或 token');
    return false;
  }

  try {
    const response = await fetch(`${API_URL}/task/${testTaskId}?secret_token=${encodeURIComponent(currentSecretToken)}`, {
      method: 'GET',
    });

    const data = await response.json();

    if (data.success && data.history) {
      log('success', `数据库历史查询成功`);
      log('db', `  总生成次数: ${data.history.total_generations}`);
      log('db', `  首次生成: ${data.history.first_generation}`);
      log('db', `  最近生成: ${data.history.last_generation}`);
      log('db', `  历史记录数: ${data.history.entries?.length || 0}`);

      // 显示最近的记录
      if (data.history.entries && data.history.entries.length > 0) {
        const latest = data.history.entries[0];
        log('info', `  最近一次生成:`);
        log('info', `    - Prompt: "${latest.prompt}"`);
        log('info', `    - 图片数: ${latest.count}`);
        log('info', `    - 时间: ${latest.created_at}`);
      }

      // 更新 token（如果返回了新 token）
      if (data.secret_token) {
        currentSecretToken = data.secret_token;
      }

      return true;
    } else {
      log('error', `数据库历史查询失败: ${data.error?.message || '未知错误'}`);
      return false;
    }
  } catch (error) {
    log('error', `查询失败: ${error.message}`);
    return false;
  }
}

/**
 * 测试 6: 导出 Markdown 历史
 */
async function testMarkdownExport() {
  log('step', '测试 6: 导出 Markdown 历史');

  if (!testTaskId || !currentSecretToken) {
    log('warning', '跳过测试: 没有可用的 task_id 或 token');
    return false;
  }

  try {
    const response = await fetch(`${API_URL}/task/${testTaskId}/export?secret_token=${encodeURIComponent(currentSecretToken)}`, {
      method: 'GET',
    });

    if (!response.ok) {
      const data = await response.json();
      log('error', `Markdown 导出失败: ${data.error?.message || '未知错误'}`);
      return false;
    }

    const markdown = await response.text();

    // 保存到文件
    const outputDir = path.join(process.cwd(), 'test-output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const markdownPath = path.join(outputDir, `task-${testTaskId}-history.md`);
    fs.writeFileSync(markdownPath, markdown, 'utf8');

    log('success', `Markdown 历史导出成功`);
    log('info', `  文件路径: ${markdownPath}`);
    log('info', `  文件大小: ${fs.statSync(markdownPath).size} bytes`);

    // 显示前几行内容
    const previewLines = markdown.split('\n').slice(0, 5).join('\n');
    console.log('\n' + '─'.repeat(70));
    console.log('Markdown 预览 (前5行):');
    console.log(previewLines);
    console.log('─'.repeat(70) + '\n');

    return true;
  } catch (error) {
    log('error', `导出失败: ${error.message}`);
    return false;
  }
}

/**
 * 测试 7: Token 轮换验证
 */
async function testTokenRotation() {
  log('step', '测试 7: Token 轮换机制验证');

  if (!testTaskId || !currentSecretToken) {
    log('warning', '跳过测试: 没有可用的 task_id 或 token');
    return false;
  }

  const oldToken = currentSecretToken;

  try {
    // 使用当前 token 进行一次调用
    const response = await fetch(`${API_URL}/generate-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: testTaskId,
        secret_token: currentSecretToken,
        prompt: 'token rotation test image',
        count: 1,
      }),
    });

    const data = await response.json();

    if (data.success && data.secret_token) {
      // 验证返回了新 token
      if (data.secret_token === oldToken) {
        log('error', 'Token 轮换失败: 新旧 token 相同');
        return false;
      }

      currentSecretToken = data.secret_token;
      log('success', 'Token 轮换机制正常');
      log('info', `  旧 token: ${oldToken.substring(0, 20)}...`);
      log('info', `  新 token: ${data.secret_token.substring(0, 20)}...`);

      // 尝试使用旧 token（应该失败）
      const oldTokenResponse = await fetch(`${API_URL}/generate-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_id: testTaskId,
          secret_token: oldToken,
          prompt: 'should fail',
          count: 1,
        }),
      });

      const oldTokenData = await oldTokenResponse.json();

      if (!oldTokenData.success && (oldTokenData.error?.code === 'TOKEN_REVOKED' || oldTokenData.error?.code === 'TOKEN_INVALID')) {
        log('success', `旧 token 正确被拒绝 - 错误码: ${oldTokenData.error.code}`);
        return true;
      } else {
        log('error', '旧 token 验证失败: 应该被拒绝但没有');
        return false;
      }
    } else {
      log('error', `Token 轮换测试失败: ${data.error?.message || '未知错误'}`);
      return false;
    }
  } catch (error) {
    log('error', `Token 轮换测试失败: ${error.message}`);
    return false;
  }
}

/**
 * 生成全链路测试报告
 */
function generateFullReport(results) {
  const timestamp = new Date().toISOString();

  const markdown = `# 异步任务 API 全链路测试报告

## 测试信息

- **测试时间**: ${timestamp}
- **Task ID**: \`${testTaskId || 'N/A'}\`
- **API URL**: ${API_URL}
- **Webhook URL**: ${WEBHOOK_URL}
- **Webhook 接收数**: ${receivedWebhooks.length}

## 测试结果

### ✅ 通过的测试 (${results.filter(r => r.passed).length}/${results.length})

${results.filter(r => r.passed).map((r, i) => `${i + 1}. ${r.name}`).join('\n') || '无'}

### ❌ 失败的测试 (${results.filter(r => !r.passed).length}/${results.length})

${results.filter(r => !r.passed).map((r, i) => `${i + 1}. ${r.name}`).join('\n') || '无'}

## 测试覆盖

### 1. Token 认证流程

- [${results.find(r => r.name.includes('创建 Token'))?.passed ? 'x' : ' '}] Token 创建接口
- [${results.find(r => r.name.includes('Token 轮换'))?.passed ? 'x' : ' '}] Token 自动轮换
- [${results.find(r => r.name.includes('Token 轮换'))?.passed ? 'x' : ' '}] 旧 Token 作废验证

### 2. 图片生成流程

- [${results.find(r => r.name.includes('异步任务'))?.passed ? 'x' : ' '}] 异步任务提交
- [${results.find(r => r.name.includes('任务状态'))?.passed ? 'x' : ' '}] 任务状态查询
- [${results.find(r => r.name.includes('Webhook'))?.passed ? 'x' : ' '}] Webhook 回调接收

### 3. 数据库验证

- [${results.find(r => r.name.includes('数据库'))?.passed ? 'x' : ' '}] D1 数据库历史查询
- [${results.find(r => r.name.includes('Markdown'))?.passed ? 'x' : ' '}] Markdown 历史导出

## Webhook 回调记录

总计收到 ${receivedWebhooks.length} 个回调

${receivedWebhooks.map((webhook, i) => `
### 回调 ${i + 1}

- **时间**: ${webhook.timestamp}
- **Job ID**: ${webhook.data.job_id}
- **Task ID**: ${webhook.data.task_id}
- **状态**: ${webhook.data.status}
- **生成时间**: ${webhook.data.generation_time}s
- **图片数**: ${webhook.data.result?.images?.length || 0}

\`\`\`json
${JSON.stringify(webhook.data, null, 2)}
\`\`\`
`).join('\n') || '*暂无回调记录*'}

## 测试统计

\`\`\`json
{
  "total_tests": ${results.length},
  "passed": ${results.filter(r => r.passed).length},
  "failed": ${results.filter(r => !r.passed).length},
  "pass_rate": "${((results.filter(r => r.passed).length / results.length) * 100).toFixed(1)}%",
  "webhooks_received": ${receivedWebhooks.length},
  "task_id": "${testTaskId || 'N/A'}",
  "api_url": "${API_URL}"
}
\`\`\`

## 数据库验证

- **D1 Database**: image-agent-db
- **Tables**: task_auth, task_memory
- **TTL**: 7天自动清理
- **Token 机制**: HMAC-SHA256 + 自动轮换

## 结论

${results.filter(r => r.passed).length === results.length
  ? '✅ **所有测试通过！** 全链路功能正常，包括 Token 认证、图片生成、数据库存储、Webhook 回调。'
  : `⚠️ **部分测试失败** (通过率: ${((results.filter(r => r.passed).length / results.length) * 100).toFixed(1)}%)，请检查失败项。`
}

---

**生成时间**: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
**测试脚本**: test/async-api-test.js
**API 版本**: 2.0 (D1 + Token Rotation)
`;

  return markdown;
}

/**
 * 仅启动 Webhook 服务
 */
async function runWebhookServerOnly() {
  console.log('\n' + '='.repeat(70));
  console.log(`${colors.bright}📡 Webhook 测试服务${colors.reset}`);
  console.log('='.repeat(70) + '\n');

  if (SKIP_INTERNAL_WEBHOOK) {
    log('warning', '检测到 SKIP_INTERNAL_WEBHOOK=true，但在 webhook-only 模式下将忽略该设置并启动服务');
  }

  log('step', '启动 Webhook 服务...');
  const webhookServer = createWebhookServer();

  await new Promise((resolve, reject) => {
    webhookServer.listen(WEBHOOK_PORT, (err) => {
      if (err) reject(err);
      else {
        log('success', `Webhook 服务已启动！`);
        console.log('');
        console.log(`  ${colors.cyan}🌐 服务地址:${colors.reset} ${LOCAL_WEBHOOK_BASE}`);
        console.log(`  ${colors.magenta}📡 Webhook URL:${colors.reset} ${WEBHOOK_URL}`);
        console.log(`  ${colors.green}💚 健康检查:${colors.reset} ${WEBHOOK_STATUS_BASE}/health`);
        console.log(`  ${colors.yellow}📋 查看回调:${colors.reset} ${WEBHOOK_STATUS_BASE}/webhooks`);
        console.log('');
        console.log('='.repeat(70));
        log('info', '服务正在运行，等待接收 Webhook 回调...');
        log('info', '按 Ctrl+C 停止服务');
        console.log('='.repeat(70) + '\n');
        resolve();
      }
    });
  });
}

/**
 * 运行完整测试
 */
async function runFullTests() {
  console.log('\n' + '='.repeat(70));
  console.log(`${colors.bright}🚀 异步任务 API 全链路测试${colors.reset}`);
  console.log('='.repeat(70));
  console.log(`${colors.cyan}📍 API 地址: ${API_URL}${colors.reset}`);
  console.log(`${colors.magenta}📡 Webhook 地址: ${WEBHOOK_URL}${colors.reset}`);
  console.log('='.repeat(70) + '\n');

  // 1. 确保 Webhook 服务就绪
  let webhookServer = null;
  if (SKIP_INTERNAL_WEBHOOK) {
    log('step', '使用外部 Webhook 服务');
    await checkExternalWebhookHealth();
  } else {
    log('step', '启动本地 Webhook 服务...');
    webhookServer = createWebhookServer();

    await new Promise((resolve, reject) => {
      webhookServer.listen(WEBHOOK_PORT, (err) => {
        if (err) reject(err);
        else {
          log('success', `Webhook 服务已启动: ${LOCAL_WEBHOOK_BASE}`);
          console.log('');
          resolve();
        }
      });
    });

    // 等待服务完全启动
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  const results = [];

  try {
    // 测试 1: 创建 Token
    console.log('\n' + '─'.repeat(70));
    const tokenResult = await testCreateToken();
    results.push({ name: '创建 Token', passed: tokenResult.success });

    if (!tokenResult.success) {
      log('error', '创建 Token 失败，跳过后续测试');
      throw new Error('Token creation failed');
    }

    // 测试 2: 提交异步任务
    console.log('\n' + '─'.repeat(70));
    const submitResult = await testAsyncTaskSubmission();
    results.push({ name: '提交异步任务', passed: submitResult.success });

    if (submitResult.success) {
      const { jobId } = submitResult;

      // 等待一下让任务开始处理
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 测试 3: 查询任务状态
      console.log('\n' + '─'.repeat(70));
      const statusResult = await testTaskStatus(jobId);
      results.push({ name: '查询任务状态', passed: statusResult });

      // 测试 4: 等待 Webhook 回调
      console.log('\n' + '─'.repeat(70));
      const webhookResult = await waitForWebhook(jobId, 120);
      results.push({ name: 'Webhook 回调接收', passed: webhookResult.success });
    } else {
      log('warning', '跳过异步任务相关测试');
      results.push({ name: '查询任务状态', passed: false });
      results.push({ name: 'Webhook 回调接收', passed: false });
    }

    // 测试 5: 查询数据库历史
    console.log('\n' + '─'.repeat(70));
    const dbResult = await testDatabaseHistory();
    results.push({ name: '数据库历史查询（D1）', passed: dbResult });

    // 测试 6: 导出 Markdown
    console.log('\n' + '─'.repeat(70));
    const exportResult = await testMarkdownExport();
    results.push({ name: 'Markdown 历史导出', passed: exportResult });

    // 测试 7: Token 轮换
    console.log('\n' + '─'.repeat(70));
    const rotationResult = await testTokenRotation();
    results.push({ name: 'Token 轮换机制验证', passed: rotationResult });

    // 生成报告
    console.log('\n' + '─'.repeat(70));
    log('step', '生成全链路测试报告...');

    const markdown = generateFullReport(results);
    const outputDir = path.join(process.cwd(), 'test-output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const reportPath = path.join(outputDir, `async-full-test-report-${Date.now()}.md`);
    fs.writeFileSync(reportPath, markdown, 'utf8');

    log('success', `全链路测试报告已保存: ${reportPath}`);

    // 输出测试结果
    console.log('\n' + '='.repeat(70));
    console.log(`${colors.bright}📊 全链路测试结果汇总${colors.reset}`);
    console.log('='.repeat(70) + '\n');

    const passed = results.filter(r => r.passed).length;
    const total = results.length;

    results.forEach((result, index) => {
      const icon = result.passed ? `${colors.green}✅${colors.reset}` : `${colors.red}❌${colors.reset}`;
      console.log(`${icon} [${index + 1}] ${result.name}`);
    });

    console.log('\n' + '='.repeat(70));
    const passRate = ((passed / total) * 100).toFixed(1);
    const resultColor = passed === total ? colors.green : (passed >= total * 0.7 ? colors.yellow : colors.red);
    console.log(`${resultColor}${colors.bright}通过率: ${passed}/${total} (${passRate}%)${colors.reset}`);
    console.log(`${colors.magenta}Webhook 接收数: ${receivedWebhooks.length}${colors.reset}`);
    console.log('='.repeat(70) + '\n');

    if (passed === total) {
      log('success', '🎉 所有全链路测试通过！');
      console.log('');
      console.log(`${colors.green}验证功能:${colors.reset}`);
      console.log('  ✅ Token 创建和校验');
      console.log('  ✅ Token 自动轮换');
      console.log('  ✅ 异步图片生成');
      console.log('  ✅ Webhook 回调');
      console.log('  ✅ D1 数据库存储');
      console.log('  ✅ Markdown 历史导出');
    } else {
      log('warning', `⚠️  部分测试失败 (${total - passed}/${total})`);
    }

  } catch (error) {
    log('error', `测试过程出错: ${error.message}`);
    console.error(error);
  } finally {
    // 关闭服务
    console.log('');
    if (SKIP_INTERNAL_WEBHOOK) {
      log('info', '外部 Webhook 服务由其他进程管理，请根据需要自行停止');
    } else {
      log('info', '按 Ctrl+C 关闭 Webhook 服务...');
    }
  }
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--webhook') || args.includes('-w')) {
    // 仅启动 webhook 服务
    await runWebhookServerOnly();
  } else if (args.includes('--help') || args.includes('-h')) {
    // 显示帮助
    console.log(`
${colors.bright}异步任务 API 全链路测试工具${colors.reset}

用法:
  npm run test:async           运行完整全链路测试
  npm run test:webhook         仅启动 Webhook 服务
  node test/async-api-test.js --help     显示帮助

环境变量:
  API_URL    API 服务地址 (默认: http://localhost:4111/api)

测试覆盖:
  ✓ Token 创建和校验
  ✓ Token 自动轮换机制
  ✓ 异步图片生成
  ✓ Webhook 回调接收
  ✓ D1 数据库历史查询
  ✓ Markdown 历史导出

Webhook 服务端点:
  POST   /webhook     接收回调
  GET    /health      健康检查
  GET    /webhooks    查看已接收的回调
    `);
    process.exit(0);
  } else {
    // 运行完整测试
    await runFullTests();
  }
}

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n');
  log('info', '正在关闭服务...');
  process.exit(0);
});

// 运行
main().catch(error => {
  log('error', `运行失败: ${error.message}`);
  console.error(error);
  process.exit(1);
});
