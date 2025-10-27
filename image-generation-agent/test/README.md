# 测试脚本说明

本目录包含了完整的测试套件，用于验证图像生成 API 的所有功能。

## 🚀 快速开始

### 一键全链路测试

```bash
# 自动化完整测试（推荐）
npm run test:full
```

这个命令会：
1. ✅ 检查所有依赖
2. ✅ 初始化 D1 数据库
3. ✅ 启动 API 服务
4. ✅ 启动 Webhook 服务
5. ✅ 运行所有测试
6. ✅ 验证数据库
7. ✅ 生成测试报告
8. ✅ 自动清理

---

## 📋 测试脚本列表

### 全链路自动化测试

| 脚本 | 命令 | 说明 |
|-----|------|------|
| **全链路集成测试** | `npm run test:full` | 🌟 **推荐** - 完全自动化，包含所有步骤 |

### 单独测试脚本

| 脚本 | 命令 | 说明 |
|-----|------|------|
| 同步 API 测试 | `npm run test:api` | Token + 图片生成 + 参数验证 |
| 异步全链路测试 | `npm run test:async` | 异步任务 + Webhook + D1 + Markdown |
| Webhook 服务 | `npm run test:webhook` | 仅启动 Webhook 接收服务 |
| D1 数据库测试 | `npm run test:d1` | 测试 D1 基本功能 |
| 认证系统测试 | `npm run test:auth` | Token 生成和轮换机制 |

---

## 🎯 全链路测试脚本详解

### 脚本位置
```
test/full-integration-test.sh
```

### 基本用法

```bash
# 完整测试（默认）
./test/full-integration-test.sh

# 或使用 npm 命令
npm run test:full
```

### 高级选项

```bash
# 显示帮助
./test/full-integration-test.sh --help

# 仅运行异步测试（跳过同步测试）
./test/full-integration-test.sh --skip-sync

# 仅运行同步测试（跳过异步测试）
./test/full-integration-test.sh --skip-async

# 测试后保持服务运行（用于调试）
./test/full-integration-test.sh --keep-running
```

### 测试流程

脚本会按以下顺序执行：

```
步骤 1/8: 检查依赖
  ✓ Node.js
  ✓ npm
  ✓ wrangler
  ✓ curl

步骤 2/8: 检查环境变量
  ✓ .dev.vars
  ✓ GOOGLE_API_KEY

步骤 3/8: 初始化 D1 数据库
  ✓ 创建本地 D1
  ✓ 应用 schema
  ✓ 验证表结构

步骤 4/8: 启动 API 服务
  ✓ 启动 Mastra dev (端口 4111)
  ✓ 健康检查

步骤 5/8: 启动 Webhook 服务
  ✓ 启动 Webhook 服务器 (端口 3999)
  ✓ 健康检查

步骤 6/8: 运行同步 API 测试
  ✓ Token 创建
  ✓ Token 轮换
  ✓ 图片生成
  ✓ 参数验证

步骤 7/8: 运行异步全链路测试
  ✓ Token 认证
  ✓ 异步任务
  ✓ Webhook 回调
  ✓ D1 数据库
  ✓ Markdown 导出

步骤 8/8: 验证数据库
  ✓ 查询认证记录
  ✓ 查询任务历史
```

### 预期输出

成功时：
```
======================================================================
✅ 所有测试通过！应用已准备好部署到生产环境 🚀
======================================================================

测试统计:
  • 通过的测试套件: 2
  • 失败的测试套件: 0
  • 通过率: 100%

生成的文件:
  • test-output/test-report-*.md
  • test-output/async-full-test-report-*.md
  • test-output/task-*-history.md

日志文件:
  • API 服务日志: /tmp/api-server.log
  • Webhook 服务日志: /tmp/webhook-server.log
```

失败时：
```
======================================================================
❌ 部分测试失败，请检查日志
======================================================================

测试统计:
  • 通过的测试套件: 1
  • 失败的测试套件: 1
  • 通过率: 50%
```

---

## 📁 生成的文件

### 测试报告

所有测试报告保存在 `test-output/` 目录：

```
test-output/
├── test-report-{task_id}.md              # 同步测试报告
├── async-full-test-report-{timestamp}.md # 异步测试报告
└── task-{task_id}-history.md             # Markdown 历史记录
```

### 日志文件

```
/tmp/api-server.log      # API 服务日志
/tmp/webhook-server.log  # Webhook 服务日志
```

---

## 🔧 手动测试流程

如果需要手动控制测试流程：

### 1. 启动服务

```bash
# 终端 1: 启动 API 服务
npm run dev

# 终端 2: 启动 Webhook 服务
npm run test:webhook
```

### 2. 运行测试

```bash
# 终端 3: 运行同步测试
npm run test:api

# 或运行异步测试
npm run test:async
```

### 3. 验证数据库

```bash
# 查看认证记录
wrangler d1 execute image-agent-db --local --command \
  "SELECT * FROM task_auth LIMIT 5"

# 查看任务历史
wrangler d1 execute image-agent-db --local --command \
  "SELECT * FROM task_memory LIMIT 5"
```

---

## 🐛 调试技巧

### 查看实时日志

```bash
# API 服务日志
tail -f /tmp/api-server.log

# Webhook 服务日志
tail -f /tmp/webhook-server.log
```

### 保持服务运行

```bash
# 测试后不关闭服务
./test/full-integration-test.sh --keep-running

# 服务会保持运行，可以手动调用 API 测试
# 按 Ctrl+C 停止
```

### 单独测试某个功能

```bash
# 仅测试同步 API
./test/full-integration-test.sh --skip-async

# 仅测试异步功能
./test/full-integration-test.sh --skip-sync
```

### 手动 API 调用

```bash
# 创建 Token
curl -X POST http://localhost:4111/api/create-token \
  -H "Content-Type: application/json" \
  -d '{"task_id": "debug_001"}'

# 使用 Token 生成图片
curl -X POST http://localhost:4111/api/generate-image \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "debug_001",
    "secret_token": "abc123.xxx...",
    "prompt": "a beautiful sunset",
    "count": 1
  }'

# 查看任务历史
curl "http://localhost:4111/api/task/debug_001?secret_token=xxx"

# 导出 Markdown
curl "http://localhost:4111/api/task/debug_001/export?secret_token=xxx"
```

---

## 🚨 常见问题

### 问题 1: 端口被占用

```bash
# 错误: EADDRINUSE: address already in use :::4111

# 解决方法: 停止占用端口的进程
lsof -ti:4111 | xargs kill -9
lsof -ti:3999 | xargs kill -9
```

### 问题 2: D1 数据库未初始化

```bash
# 错误: Cannot read properties of undefined (reading 'prepare')

# 解决方法: 初始化 D1
wrangler d1 execute image-agent-db --local --file=migrations/0001_initial_schema.sql
```

### 问题 3: API Key 未配置

```bash
# 错误: GOOGLE_API_KEY 未配置

# 解决方法: 编辑 .dev.vars
echo "GOOGLE_API_KEY=your_api_key_here" > .dev.vars
```

### 问题 4: 服务启动超时

```bash
# 错误: API 服务启动失败或超时

# 解决方法: 检查日志
tail /tmp/api-server.log

# 或手动启动服务查看错误
npm run dev
```

---

## 📊 测试覆盖

### 功能覆盖

- ✅ **Token 认证系统**
  - Token 创建接口
  - Token 自动轮换
  - 旧 Token 作废验证
  - HMAC-SHA256 加密

- ✅ **图片生成**
  - 同步生成
  - 异步生成
  - 批量生成 (1-5张)
  - R2 云存储

- ✅ **Webhook 回调**
  - 任务完成通知
  - 任务失败通知
  - 回调数据验证

- ✅ **数据库存储**
  - D1 认证记录
  - D1 任务历史
  - 7天 TTL
  - 历史查询

- ✅ **Markdown 导出**
  - 任务历史导出
  - 格式化输出
  - 包含图片信息

- ✅ **参数验证**
  - 必需参数检查
  - Count 范围验证 (1-5)
  - Token 格式验证

- ✅ **错误处理**
  - 友好的错误信息
  - 错误码规范
  - 异常捕获

---

## 🔗 相关文档

- [TESTING_GUIDE.md](../TESTING_GUIDE.md) - 详细测试指南
- [QUICK_TEST.md](../QUICK_TEST.md) - 快速参考
- [API_GUIDE.md](../API_GUIDE.md) - API 使用指南
- [D1_SETUP.md](../D1_SETUP.md) - D1 数据库配置

---

## 💡 最佳实践

1. **每次代码修改后** - 运行 `npm run test:full` 确保没有破坏现有功能
2. **发布前** - 必须运行完整测试并全部通过
3. **调试时** - 使用 `--keep-running` 保持服务运行
4. **CI/CD** - 集成 `test:full` 到自动化流程

---

## ✅ 准备部署

当所有测试通过后，你的应用已经准备好部署：

```bash
# 1. 确保所有测试通过
npm run test:full

# 2. 构建验证
npm run build

# 3. 部署到生产
npm run deploy
```

🚀 **祝测试顺利！**
