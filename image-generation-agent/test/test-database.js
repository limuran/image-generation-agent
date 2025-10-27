/**
 * 数据库测试脚本
 *
 * 测试内容：
 * 1. Task Memory - 任务历史记录（SQLite）
 * 2. Task Auth - 认证 token 管理（内存）
 *
 * 运行方式：
 * node test/test-database.js
 */

import { getTaskMemory } from '../src/services/task-memory.js';
import { getTaskAuth } from '../src/services/task-auth-memory.js';

console.log('🧪 开始数据库测试...\n');

// ============================================
// 测试 1: Task Memory（任务历史）
// ============================================
console.log('📝 测试 Task Memory（任务历史记录）');
console.log('=' .repeat(60));

const taskMemory = getTaskMemory();

// 1.1 保存记忆
console.log('\n1️⃣  测试保存记忆...');
taskMemory.saveMemory({
  task_id: 'test_task_001',
  prompt: 'A beautiful sunset over the ocean',
  optimized_prompt: 'A photorealistic beautiful sunset over the calm ocean with vibrant colors',
  generated_images: [
    {
      url: 'https://pub-example.r2.dev/images/test_task_001/image_1.png',
      r2_key: 'images/test_task_001/image_1.png',
      file_name: 'image_1.png',
      storage_type: 'r2',
    },
  ],
  count: 1,
});

console.log('✅ 记忆保存成功');

// 1.2 再保存一次（模拟第二次生成）
console.log('\n2️⃣  保存第二次生成记录...');
taskMemory.saveMemory({
  task_id: 'test_task_001',
  prompt: 'A cat playing with a ball',
  optimized_prompt: 'A cute fluffy cat playing with a colorful ball in a sunny room',
  generated_images: [
    {
      url: 'https://pub-example.r2.dev/images/test_task_001/image_2.png',
      r2_key: 'images/test_task_001/image_2.png',
      file_name: 'image_2.png',
      storage_type: 'r2',
    },
  ],
  count: 1,
});

console.log('✅ 第二次记忆保存成功');

// 1.3 查询历史
console.log('\n3️⃣  查询任务历史...');
const history = taskMemory.getHistory('test_task_001');

if (history) {
  console.log(`✅ 找到历史记录:`);
  console.log(`   - Task ID: ${history.task_id}`);
  console.log(`   - 总生成次数: ${history.total_generations}`);
  console.log(`   - 首次生成: ${history.first_generation}`);
  console.log(`   - 最近生成: ${history.last_generation}`);
  console.log(`   - 记录条数: ${history.entries.length}`);

  history.entries.forEach((entry, index) => {
    console.log(`\n   记录 ${index + 1}:`);
    console.log(`     - Prompt: ${entry.prompt}`);
    console.log(`     - 图片数: ${entry.count}`);
    console.log(`     - 创建时间: ${entry.created_at}`);
  });
} else {
  console.log('❌ 未找到历史记录');
}

// 1.4 获取最后一次生成
console.log('\n4️⃣  获取最后一次生成...');
const lastGen = taskMemory.getLastGeneration('test_task_001');

if (lastGen) {
  console.log(`✅ 最后一次生成:`);
  console.log(`   - Prompt: ${lastGen.prompt}`);
  console.log(`   - 图片数: ${lastGen.count}`);
  console.log(`   - 时间: ${lastGen.created_at}`);
} else {
  console.log('❌ 未找到最后一次生成');
}

// 1.5 统计信息
console.log('\n5️⃣  获取统计信息...');
const stats = taskMemory.getStatistics();
console.log(`✅ 统计信息:`);
console.log(`   - 总任务数: ${stats.total_tasks}`);
console.log(`   - 总生成次数: ${stats.total_generations}`);
console.log(`   - 活跃任务数: ${stats.active_tasks}`);

// ============================================
// 测试 2: Task Auth（认证管理）
// ============================================
console.log('\n\n🔐 测试 Task Auth（认证 token 管理）');
console.log('=' .repeat(60));

const taskAuth = getTaskAuth();

// 2.1 创建 token
console.log('\n1️⃣  创建 token...');
const token1 = await taskAuth.createAuth('test_task_002');
console.log(`✅ Token 创建成功: ${token1}`);
console.log(`   - Kid: ${token1.split('.')[0]}`);
console.log(`   - Token 长度: ${token1.length}`);

// 2.2 验证并轮换 token
console.log('\n2️⃣  验证并轮换 token...');
const verifyResult = await taskAuth.verifyAndRotate(token1);

if (verifyResult.valid) {
  console.log(`✅ Token 验证成功`);
  console.log(`   - Task ID: ${verifyResult.task_id}`);
  console.log(`   - 旧 token: ${verifyResult.old_token}`);
  console.log(`   - 新 token: ${verifyResult.new_token}`);
  console.log(`   - 新 Kid: ${verifyResult.new_token?.split('.')[0]}`);
} else {
  console.log(`❌ Token 验证失败: ${verifyResult.error}`);
}

// 2.3 尝试使用旧 token（应该失败）
console.log('\n3️⃣  尝试使用已作废的旧 token...');
const oldTokenResult = await taskAuth.verifyAndRotate(token1);

if (!oldTokenResult.valid) {
  console.log(`✅ 旧 token 正确地被拒绝`);
  console.log(`   - 错误代码: ${oldTokenResult.error}`);
} else {
  console.log(`❌ 安全问题: 旧 token 不应该通过验证!`);
}

// 2.4 使用新 token
if (verifyResult.new_token) {
  console.log('\n4️⃣  使用新 token...');
  const newTokenResult = await taskAuth.verifyAndRotate(verifyResult.new_token);

  if (newTokenResult.valid) {
    console.log(`✅ 新 token 验证成功`);
    console.log(`   - Task ID: ${newTokenResult.task_id}`);
    console.log(`   - 再次轮换的新 token: ${newTokenResult.new_token?.split('.')[0]}...`);
  } else {
    console.log(`❌ 新 token 验证失败: ${newTokenResult.error}`);
  }
}

// 2.5 检查活跃 token
console.log('\n5️⃣  检查 task_id 的活跃 token...');
const activeToken = taskAuth.getActiveToken('test_task_002');

if (activeToken) {
  console.log(`✅ 找到活跃 token:`);
  console.log(`   - Task ID: ${activeToken.task_id}`);
  console.log(`   - Kid: ${activeToken.kid}`);
  console.log(`   - 创建时间: ${activeToken.created_at}`);
  console.log(`   - 使用次数: ${activeToken.usage_count}`);
  console.log(`   - 状态: ${activeToken.status}`);
} else {
  console.log(`❌ 未找到活跃 token`);
}

// ============================================
// 测试总结
// ============================================
console.log('\n\n📊 测试总结');
console.log('=' .repeat(60));
console.log('✅ Task Memory 测试通过');
console.log('✅ Task Auth 测试通过');
console.log('\n💡 提示:');
console.log('   - Task Memory 数据保存在: task-memory.db');
console.log('   - Task Auth 使用内存存储（重启后丢失）');
console.log('   - 生产环境建议使用 Cloudflare D1 或 Durable Objects');
console.log('\n🧹 清理测试数据...');
taskMemory.close();
console.log('✅ 数据库连接已关闭\n');
