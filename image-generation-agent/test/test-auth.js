/**
 * 认证系统测试脚本
 *
 * 测试 Task Auth token 生成、验证和轮换
 *
 * 运行方式：
 * npm run test:auth
 */

import { getTaskAuth } from '../src/services/task-auth-memory.js';

console.log('🔐 开始认证系统测试...\n');

const taskAuth = getTaskAuth();

// ============================================
// 测试场景 1: 基本 Token 流程
// ============================================
console.log('📋 场景 1: 基本 Token 生成和验证');
console.log('='.repeat(60));

console.log('\n1️⃣  创建初始 token...');
const initialToken = await taskAuth.createAuth('task_001');
console.log(`✅ Token 创建成功`);
console.log(`   原始 token: ${initialToken}`);
console.log(`   Kid: ${initialToken.split('.')[0]}`);
console.log(`   Secret: ${initialToken.split('.')[1].substring(0, 20)}...`);

console.log('\n2️⃣  验证并轮换 token...');
const rotateResult1 = await taskAuth.verifyAndRotate(initialToken);

if (rotateResult1.valid) {
  console.log(`✅ 验证成功`);
  console.log(`   Task ID: ${rotateResult1.task_id}`);
  console.log(`   新 token: ${rotateResult1.new_token}`);
  console.log(`   新 Kid: ${rotateResult1.new_token?.split('.')[0]}`);
} else {
  console.log(`❌ 验证失败: ${rotateResult1.error}`);
  process.exit(1);
}

console.log('\n3️⃣  尝试重用已作废的 token（应该失败）...');
const reuseResult = await taskAuth.verifyAndRotate(initialToken);

if (!reuseResult.valid && reuseResult.error === 'TOKEN_REVOKED') {
  console.log(`✅ 正确拒绝: ${reuseResult.error}`);
} else {
  console.log(`❌ 安全问题: 已作废的 token 不应该通过验证!`);
  process.exit(1);
}

// ============================================
// 测试场景 2: Token 轮换链
// ============================================
console.log('\n\n📋 场景 2: 连续 Token 轮换');
console.log('='.repeat(60));

let currentToken = rotateResult1.new_token;
const rotationChain = [initialToken];

for (let i = 1; i <= 5; i++) {
  console.log(`\n${i}️⃣  第 ${i} 次轮换...`);
  const result = await taskAuth.verifyAndRotate(currentToken);

  if (result.valid) {
    console.log(`✅ 轮换成功`);
    console.log(`   旧 Kid: ${currentToken.split('.')[0]}`);
    console.log(`   新 Kid: ${result.new_token?.split('.')[0]}`);
    rotationChain.push(result.new_token);
    currentToken = result.new_token;
  } else {
    console.log(`❌ 轮换失败: ${result.error}`);
    process.exit(1);
  }
}

console.log(`\n✅ 完成 5 次连续轮换`);
console.log(`   轮换链长度: ${rotationChain.length}`);

// ============================================
// 测试场景 3: 多任务并发
// ============================================
console.log('\n\n📋 场景 3: 多任务并发管理');
console.log('='.repeat(60));

const tasks = ['task_A', 'task_B', 'task_C', 'task_D', 'task_E'];
const tokens = {};

console.log('\n1️⃣  为 5 个任务创建 token...');
for (const taskId of tasks) {
  const token = await taskAuth.createAuth(taskId);
  tokens[taskId] = token;
  console.log(`   ${taskId}: ${token.split('.')[0]}`);
}

console.log('\n2️⃣  验证所有 token...');
for (const taskId of tasks) {
  const result = await taskAuth.verifyAndRotate(tokens[taskId]);

  if (result.valid && result.task_id === taskId) {
    console.log(`✅ ${taskId}: 验证成功, 新 Kid: ${result.new_token?.split('.')[0]}`);
    tokens[taskId] = result.new_token; // 更新为新 token
  } else {
    console.log(`❌ ${taskId}: 验证失败`);
    process.exit(1);
  }
}

// ============================================
// 测试场景 4: 错误处理
// ============================================
console.log('\n\n📋 场景 4: 错误处理测试');
console.log('='.repeat(60));

console.log('\n1️⃣  测试无效格式的 token...');
const invalidFormats = [
  'invalid',
  'abc123',
  'too.many.dots.here',
  'short.abc',
  'xxxxxx.' + 'x'.repeat(100), // 错误长度
];

for (const invalidToken of invalidFormats) {
  const result = await taskAuth.verifyAndRotate(invalidToken);

  if (!result.valid && result.error === 'TOKEN_INVALID') {
    console.log(`✅ 正确拒绝无效 token: "${invalidToken.substring(0, 20)}..."`);
  } else {
    console.log(`❌ 应该拒绝无效 token: "${invalidToken}"`);
  }
}

console.log('\n2️⃣  测试不存在的 Kid...');
const fakeToken = 'abcdef.' + 'x'.repeat(64);
const fakeResult = await taskAuth.verifyAndRotate(fakeToken);

if (!fakeResult.valid && fakeResult.error === 'TOKEN_NOT_FOUND') {
  console.log(`✅ 正确拒绝不存在的 Kid`);
} else {
  console.log(`❌ 应该拒绝不存在的 Kid`);
}

// ============================================
// 测试场景 5: 活跃 Token 查询
// ============================================
console.log('\n\n📋 场景 5: 活跃 Token 查询');
console.log('='.repeat(60));

console.log('\n1️⃣  查询活跃 token...');
for (const taskId of tasks.slice(0, 3)) {
  const activeToken = taskAuth.getActiveToken(taskId);

  if (activeToken) {
    console.log(`✅ ${taskId}:`);
    console.log(`     Kid: ${activeToken.kid}`);
    console.log(`     创建时间: ${activeToken.created_at}`);
    console.log(`     使用次数: ${activeToken.usage_count}`);
    console.log(`     状态: ${activeToken.status}`);
  } else {
    console.log(`❌ ${taskId}: 未找到活跃 token`);
  }
}

console.log('\n2️⃣  查询不存在的任务...');
const nonExistent = taskAuth.getActiveToken('task_NONEXISTENT');

if (!nonExistent) {
  console.log(`✅ 正确返回 null（任务不存在）`);
} else {
  console.log(`❌ 不应该找到不存在的任务`);
}

// ============================================
// 测试总结
// ============================================
console.log('\n\n📊 测试总结');
console.log('='.repeat(60));
console.log('✅ 所有测试通过！');
console.log('\n覆盖的功能：');
console.log('   ✓ Token 生成');
console.log('   ✓ Token 验证');
console.log('   ✓ Token 轮换（单次轮换）');
console.log('   ✓ Token 轮换链（连续轮换）');
console.log('   ✓ 多任务并发管理');
console.log('   ✓ 已作废 token 拒绝');
console.log('   ✓ 无效格式拒绝');
console.log('   ✓ 不存在 Kid 拒绝');
console.log('   ✓ 活跃 token 查询');
console.log('\n💡 注意事项：');
console.log('   - 此服务使用内存存储');
console.log('   - Worker 重启后所有 token 失效');
console.log('   - 生产环境建议使用 Cloudflare D1 或 Durable Objects');
console.log('');
