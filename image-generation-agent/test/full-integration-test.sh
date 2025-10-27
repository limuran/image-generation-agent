#!/bin/bash

###############################################################################
# 全链路集成测试脚本
#
# 功能:
# 1. 环境检查和初始化
# 2. 启动 API 服务
# 3. 启动 Webhook 服务
# 4. 执行全链路测试
# 5. 验证数据库
# 6. 生成测试报告
# 7. 清理和总结
#
# 用法:
#   chmod +x test/full-integration-test.sh
#   ./test/full-integration-test.sh
#
###############################################################################

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# 配置
# 使用 wrangler dev (端口 8787) 而不是 mastra dev (端口 4111)
# 因为需要 D1 数据库支持
API_PORT=8787
WEBHOOK_PORT=3999
API_BASE_URL="http://localhost:${API_PORT}"
API_URL="${API_BASE_URL}/api"
WEBHOOK_URL="http://localhost:${WEBHOOK_PORT}/webhook"
API_PID=""
WEBHOOK_PID=""
TEST_PASSED=0
TEST_FAILED=0

# 日志函数
log_info() {
    echo -e "${CYAN}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✅${NC} $1"
}

log_error() {
    echo -e "${RED}❌${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠️${NC} $1"
}

log_step() {
    echo -e "${BOLD}${BLUE}🔍${NC} $1"
}

log_header() {
    echo ""
    echo "======================================================================"
    echo -e "${BOLD}$1${NC}"
    echo "======================================================================"
    echo ""
}

# 清理函数
cleanup() {
    log_step "清理进程..."

    if [ ! -z "$API_PID" ]; then
        log_info "停止 API 服务 (PID: $API_PID)"
        kill $API_PID 2>/dev/null || true
    fi

    if [ ! -z "$WEBHOOK_PID" ]; then
        log_info "停止 Webhook 服务 (PID: $WEBHOOK_PID)"
        kill $WEBHOOK_PID 2>/dev/null || true
    fi

    # 清理可能残留的进程
    pkill -f "wrangler dev" 2>/dev/null || true
    pkill -f "node test/async-api-test.js --webhook" 2>/dev/null || true

    log_success "清理完成"
}

# 设置退出陷阱
trap cleanup EXIT INT TERM

# 检查依赖
check_dependencies() {
    log_header "步骤 1/8: 检查依赖"

    local missing_deps=0

    # 检查 Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js 未安装"
        missing_deps=1
    else
        local node_version=$(node -v)
        log_success "Node.js 已安装: $node_version"
    fi

    # 检查 npm
    if ! command -v npm &> /dev/null; then
        log_error "npm 未安装"
        missing_deps=1
    else
        local npm_version=$(npm -v)
        log_success "npm 已安装: v$npm_version"
    fi

    # 检查 wrangler
    if ! command -v wrangler &> /dev/null; then
        log_error "wrangler 未安装"
        missing_deps=1
    else
        local wrangler_version=$(wrangler --version 2>&1 | head -n 1)
        log_success "wrangler 已安装: $wrangler_version"
    fi

    # 检查 curl
    if ! command -v curl &> /dev/null; then
        log_error "curl 未安装"
        missing_deps=1
    else
        log_success "curl 已安装"
    fi

    if [ $missing_deps -eq 1 ]; then
        log_error "缺少必要依赖，请先安装"
        exit 1
    fi

    log_success "所有依赖检查通过"
}

# 检查环境变量
check_environment() {
    log_header "步骤 2/8: 检查环境变量"

    if [ ! -f ".dev.vars" ]; then
        log_warning ".dev.vars 文件不存在，将使用环境变量"
    else
        log_success ".dev.vars 文件存在"
    fi

    # 检查 GOOGLE_API_KEY
    if [ -z "$GOOGLE_API_KEY" ] && ! grep -q "GOOGLE_API_KEY" .dev.vars 2>/dev/null; then
        log_warning "GOOGLE_API_KEY 未配置，图片生成可能失败"
        log_info "请在 .dev.vars 中添加: GOOGLE_API_KEY=your_key"
    else
        log_success "GOOGLE_API_KEY 已配置"
    fi
}

# 初始化 D1 数据库
init_database() {
    log_header "步骤 3/8: 初始化 D1 数据库"

    if [ ! -f "migrations/0001_initial_schema.sql" ]; then
        log_error "找不到数据库 schema 文件: migrations/0001_initial_schema.sql"
        exit 1
    fi

    log_info "初始化本地 D1 数据库..."

    # 创建本地 D1 数据库
    if wrangler d1 execute image-agent-db --local --file=migrations/0001_initial_schema.sql > /dev/null 2>&1; then
        log_success "D1 数据库初始化成功"
    else
        log_warning "D1 数据库可能已经初始化，跳过"
    fi

    # 验证数据库表
    log_info "验证数据库表..."
    local tables=$(wrangler d1 execute image-agent-db --local --command "SELECT name FROM sqlite_master WHERE type='table'" 2>/dev/null | grep -E "task_auth|task_memory" | wc -l)

    if [ "$tables" -ge 2 ]; then
        log_success "数据库表验证通过 (task_auth, task_memory)"
    else
        log_error "数据库表验证失败"
        exit 1
    fi
}

# 启动 API 服务
start_api_server() {
    log_header "步骤 4/8: 启动 API 服务"

    log_info "启动 Cloudflare Workers 开发服务器 (端口: $API_PORT)..."

    # 启动 API 服务（使用 wrangler dev 以支持 D1 数据库）
    npm run dev:worker > /tmp/api-server.log 2>&1 &
    API_PID=$!

    log_info "API 服务 PID: $API_PID"
    log_info "等待服务启动..."

    # 等待 API 服务就绪
    local max_attempts=30
    local attempt=0

    while [ $attempt -lt $max_attempts ]; do
        # Workers 的健康检查端点在 /api/health
        if curl -s "$API_URL/health" > /dev/null 2>&1; then
            # 验证健康检查
            local health_response=$(curl -s "$API_URL/health")
            if echo "$health_response" | grep -q "ok"; then
                echo ""
                log_success "API 服务启动成功: $API_BASE_URL"
                log_success "健康检查通过 (/api/health)"
                log_info "API 端点: $API_URL"
                return 0
            fi
        fi

        attempt=$((attempt + 1))
        echo -n "."
        sleep 1
    done

    echo ""
    log_error "API 服务启动失败或超时"
    log_info "查看日志: tail /tmp/api-server.log"
    exit 1
}

# 启动 Webhook 服务
start_webhook_server() {
    log_header "步骤 5/8: 启动 Webhook 服务"

    log_info "启动 Webhook 测试服务器 (端口: $WEBHOOK_PORT)..."

    # 启动 Webhook 服务
    node test/async-api-test.js --webhook > /tmp/webhook-server.log 2>&1 &
    WEBHOOK_PID=$!

    log_info "Webhook 服务 PID: $WEBHOOK_PID"
    log_info "等待服务启动..."

    # 等待 Webhook 服务就绪
    local max_attempts=10
    local attempt=0

    while [ $attempt -lt $max_attempts ]; do
        if curl -s "http://localhost:$WEBHOOK_PORT/health" > /dev/null 2>&1; then
            echo ""
            log_success "Webhook 服务启动成功: http://localhost:$WEBHOOK_PORT"
            return 0
        fi

        attempt=$((attempt + 1))
        echo -n "."
        sleep 1
    done

    echo ""
    log_error "Webhook 服务启动失败或超时"
    log_info "查看日志: tail /tmp/webhook-server.log"
    exit 1
}

# 运行同步 API 测试
run_sync_tests() {
    log_header "步骤 6/8: 运行同步 API 测试"

    log_info "执行同步 API 测试..."

    if API_URL="$API_URL" npm run test:api; then
        log_success "同步 API 测试通过"
        TEST_PASSED=$((TEST_PASSED + 1))
        return 0
    else
        log_error "同步 API 测试失败"
        TEST_FAILED=$((TEST_FAILED + 1))
        return 1
    fi
}

# 运行异步全链路测试
run_async_tests() {
    log_header "步骤 7/8: 运行异步全链路测试"

    log_info "执行异步全链路测试..."
    log_info "测试内容:"
    log_info "  • Token 创建和校验"
    log_info "  • Token 自动轮换"
    log_info "  • 异步图片生成"
    log_info "  • Webhook 回调接收"
    log_info "  • D1 数据库验证"
    log_info "  • Markdown 历史导出"
    echo ""

    # 设置环境变量
    export API_URL="$API_URL"

    if node test/async-api-test.js; then
        log_success "异步全链路测试通过"
        TEST_PASSED=$((TEST_PASSED + 1))
        return 0
    else
        log_error "异步全链路测试失败"
        TEST_FAILED=$((TEST_FAILED + 1))
        return 1
    fi
}

# 验证数据库
verify_database() {
    log_header "步骤 8/8: 验证数据库"

    log_info "查询 D1 数据库..."

    # 查询认证记录
    log_step "检查 task_auth 表..."
    local auth_count=$(wrangler d1 execute image-agent-db --local --command "SELECT COUNT(*) as count FROM task_auth" 2>/dev/null | grep -oP '\d+' | tail -1)

    if [ ! -z "$auth_count" ]; then
        log_success "task_auth 表有 $auth_count 条记录"
    else
        log_warning "无法查询 task_auth 表"
    fi

    # 查询任务历史
    log_step "检查 task_memory 表..."
    local memory_count=$(wrangler d1 execute image-agent-db --local --command "SELECT COUNT(*) as count FROM task_memory" 2>/dev/null | grep -oP '\d+' | tail -1)

    if [ ! -z "$memory_count" ]; then
        log_success "task_memory 表有 $memory_count 条记录"
    else
        log_warning "无法查询 task_memory 表"
    fi

    # 显示最近的记录
    if [ ! -z "$memory_count" ] && [ "$memory_count" -gt 0 ]; then
        log_info "最近的任务记录:"
        wrangler d1 execute image-agent-db --local --command \
            "SELECT task_id, prompt, count, created_at FROM task_memory ORDER BY created_at DESC LIMIT 3" 2>/dev/null || true
    fi
}

# 生成总结报告
generate_summary() {
    log_header "测试完成 - 总结报告"

    echo -e "${BOLD}测试统计:${NC}"
    echo "  • 通过的测试套件: $TEST_PASSED"
    echo "  • 失败的测试套件: $TEST_FAILED"

    local total_tests=$((TEST_PASSED + TEST_FAILED))
    if [ $total_tests -gt 0 ]; then
        local pass_rate=$((TEST_PASSED * 100 / total_tests))
        echo "  • 通过率: $pass_rate%"
    fi

    echo ""
    echo -e "${BOLD}生成的文件:${NC}"
    if [ -d "test-output" ]; then
        ls -lh test-output/*.md 2>/dev/null | while read line; do
            echo "  • $line"
        done
    else
        echo "  • 无测试输出文件"
    fi

    echo ""
    echo -e "${BOLD}日志文件:${NC}"
    echo "  • API 服务日志: /tmp/api-server.log"
    echo "  • Webhook 服务日志: /tmp/webhook-server.log"

    echo ""

    if [ $TEST_FAILED -eq 0 ]; then
        echo "======================================================================"
        echo -e "${GREEN}${BOLD}✅ 所有测试通过！应用已准备好部署到生产环境 🚀${NC}"
        echo "======================================================================"
        exit 0
    else
        echo "======================================================================"
        echo -e "${RED}${BOLD}❌ 部分测试失败，请检查日志${NC}"
        echo "======================================================================"
        exit 1
    fi
}

# 主函数
main() {
    log_header "🚀 全链路集成测试"

    echo -e "${CYAN}测试配置:${NC}"
    echo "  • API URL: $API_URL"
    echo "  • Webhook URL: $WEBHOOK_URL"
    echo "  • 工作目录: $(pwd)"
    echo ""

    # 执行测试步骤
    check_dependencies
    check_environment
    init_database
    start_api_server
    start_webhook_server

    # 等待一下确保所有服务稳定
    sleep 2

    run_sync_tests
    run_async_tests
    verify_database

    # 生成总结
    generate_summary
}

# 显示帮助
show_help() {
    cat << EOF
全链路集成测试脚本

用法:
  ./test/full-integration-test.sh [选项]

选项:
  -h, --help          显示此帮助信息
  --skip-sync         跳过同步 API 测试
  --skip-async        跳过异步全链路测试
  --keep-running      测试后保持服务运行（用于调试）

示例:
  # 运行完整测试
  ./test/full-integration-test.sh

  # 仅运行异步测试
  ./test/full-integration-test.sh --skip-sync

  # 测试后保持服务运行
  ./test/full-integration-test.sh --keep-running

环境变量:
  API_URL             API 服务地址（默认: http://localhost:4111/api）
  GOOGLE_API_KEY      Google Gemini API Key（从 .dev.vars 读取）

测试覆盖:
  ✓ Token 创建和校验
  ✓ Token 自动轮换机制
  ✓ 图片生成（同步/异步）
  ✓ Webhook 回调
  ✓ D1 数据库存储
  ✓ Markdown 历史导出
  ✓ 参数验证
  ✓ 错误处理

生成文件:
  • test-output/test-report-*.md              同步测试报告
  • test-output/async-full-test-report-*.md   异步测试报告
  • test-output/task-*-history.md             Markdown 历史
  • /tmp/api-server.log                       API 服务日志
  • /tmp/webhook-server.log                   Webhook 服务日志

EOF
}

# 解析命令行参数
SKIP_SYNC=0
SKIP_ASYNC=0
KEEP_RUNNING=0

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        --skip-sync)
            SKIP_SYNC=1
            shift
            ;;
        --skip-async)
            SKIP_ASYNC=1
            shift
            ;;
        --keep-running)
            KEEP_RUNNING=1
            shift
            ;;
        *)
            log_error "未知选项: $1"
            echo "使用 --help 查看帮助"
            exit 1
            ;;
    esac
done

# 根据参数调整测试流程
if [ $SKIP_SYNC -eq 1 ]; then
    run_sync_tests() {
        log_warning "跳过同步 API 测试（--skip-sync）"
        return 0
    }
fi

if [ $SKIP_ASYNC -eq 1 ]; then
    run_async_tests() {
        log_warning "跳过异步全链路测试（--skip-async）"
        return 0
    }
fi

if [ $KEEP_RUNNING -eq 1 ]; then
    cleanup() {
        log_info "服务保持运行（--keep-running）"
        log_info "API 服务: http://localhost:$API_PORT"
        log_info "Webhook 服务: http://localhost:$WEBHOOK_PORT"
        log_info "按 Ctrl+C 停止服务"
        wait
    }
fi

# 运行主函数
main
