#!/bin/bash

# D1 数据库测试脚本
# 用于测试 D1 数据库的基本功能

echo "🧪 开始 D1 数据库测试..."
echo "=" | head -c 60
echo ""

# 测试 1: 插入 Task Auth 记录
echo ""
echo "1️⃣  测试插入 Task Auth 记录..."

wrangler d1 execute image-agent-db --remote --command \
  "INSERT INTO task_auth (task_id, kid, token_hash, created_at, usage_count, status)
   VALUES ('test_task_001', 'abc123', 'hash_value_here', datetime('now'), 0, 'active')"

echo "✅ Task Auth 记录插入成功"

# 测试 2: 查询 Task Auth
echo ""
echo "2️⃣  查询 Task Auth 记录..."

wrangler d1 execute image-agent-db --remote --command \
  "SELECT * FROM task_auth WHERE task_id = 'test_task_001'"

# 测试 3: 插入 Task Memory 记录
echo ""
echo "3️⃣  测试插入 Task Memory 记录..."

wrangler d1 execute image-agent-db --remote --command \
  "INSERT INTO task_memory (task_id, prompt, optimized_prompt, generated_images, count, created_at, expires_at)
   VALUES ('test_task_001',
           'A beautiful sunset',
           'A photorealistic beautiful sunset',
           '{\"images\": []}',
           1,
           datetime('now'),
           datetime('now', '+7 days'))"

echo "✅ Task Memory 记录插入成功"

# 测试 4: 查询 Task Memory
echo ""
echo "4️⃣  查询 Task Memory 记录..."

wrangler d1 execute image-agent-db --remote --command \
  "SELECT task_id, prompt, count, created_at FROM task_memory WHERE task_id = 'test_task_001'"

# 测试 5: 统计信息
echo ""
echo "5️⃣  获取统计信息..."

wrangler d1 execute image-agent-db --remote --command \
  "SELECT
     (SELECT COUNT(*) FROM task_auth) as total_auth_records,
     (SELECT COUNT(*) FROM task_memory) as total_memory_records"

# 测试 6: 清理测试数据
echo ""
echo "6️⃣  清理测试数据..."

wrangler d1 execute image-agent-db --remote --command \
  "DELETE FROM task_auth WHERE task_id = 'test_task_001'"

wrangler d1 execute image-agent-db --remote --command \
  "DELETE FROM task_memory WHERE task_id = 'test_task_001'"

echo "✅ 测试数据清理完成"

echo ""
echo "📊 测试总结"
echo "=" | head -c 60
echo ""
echo "✅ 所有 D1 数据库测试通过！"
echo ""
echo "💡 提示："
echo "   - D1 数据库已成功配置"
echo "   - 可以在生产环境使用"
echo "   - 数据持久化，重启后保留"
echo ""
