#!/bin/bash

###############################################################################
# 生产环境健康巡检脚本
#
# 会对已部署的 Cloudflare Worker 进行健康检查、同步/异步 API 测试。
# 异步测试复用既有的 webhook 服务脚本（npm run test:webhook）。
#
# 用法:
#   chmod +x test/prod-integration-test.sh
#   ./test/prod-integration-test.sh --async \
#       --api-url https://your-domain.workers.dev/api \
#       --webhook-url https://public-webhook.example.com/webhook
#
# 可选参数:
#   --api-url <url>       指定生产 API 地址 (默认: https://image-generation-agent.limuran818.workers.dev/api)
#   --webhook-url <url>   指定 Cloudflare 可访问的 Webhook 地址
#   --webhook-port <port> 本地 webhook 监听端口 (默认: 3999)
#   --async               运行异步+Webhook 测试
#   --skip-sync           跳过同步 API 测试
#   --skip-async          跳过异步测试 (默认)
#   --keep-webhook        测试后保留 webhook 服务，便于排查
#   -h/--help             查看帮助
###############################################################################

set -euo pipefail

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m'

# 默认配置
DEFAULT_API_URL="https://image-generation-agent.limuran818.workers.dev/api"
API_URL="${API_URL:-${PROD_API_URL:-$DEFAULT_API_URL}}"
WEBHOOK_PORT="${WEBHOOK_PORT:-3999}"
WEBHOOK_URL="${WEBHOOK_URL:-${PROD_WEBHOOK_URL:-"http://localhost:${WEBHOOK_PORT}/webhook"}}"
WEBHOOK_INTERNAL_BASE="${WEBHOOK_INTERNAL_BASE:-http://localhost:${WEBHOOK_PORT}}"

RUN_SYNC=1
RUN_ASYNC=0
KEEP_WEBHOOK=0

print_help() {
  cat <<EOF
生产环境巡检脚本

用法:
  ./test/prod-integration-test.sh [选项]

选项:
  --api-url <url>       指定生产 API 地址 (默认: $DEFAULT_API_URL)
  --webhook-url <url>   指定 Webhook 回调地址 (对 Cloudflare 可访问)
  --webhook-port <port> 本地 webhook 监听端口 (默认: 3999)
  --async               启用异步测试 (默认仅运行同步用例)
  --skip-sync           跳过同步 API 测试
  --skip-async          跳过异步测试
  --keep-webhook        测试完成后保留 webhook 服务，便于排查
  -h, --help            查看帮助

环境变量:
  API_URL / PROD_API_URL           覆盖 API 地址
  WEBHOOK_URL / PROD_WEBHOOK_URL   覆盖 Webhook 地址
  WEBHOOK_PORT                     覆盖本地监听端口
  WEBHOOK_INTERNAL_BASE            获取 webhook 状态用的本地地址 (默认 http://localhost:PORT)

提示:
  异步测试会使用 \`npm run test:webhook\` 启动本地 webhook 服务，
  并要求 Cloudflare Worker 能访问到 WEBHOOK_URL（可通过隧道或公网地址暴露本机服务）。
EOF
}

# 解析参数
while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-url)
      API_URL="$2"
      shift 2
      ;;
    --webhook-url)
      WEBHOOK_URL="$2"
      shift 2
      ;;
    --webhook-port)
      WEBHOOK_PORT="$2"
      WEBHOOK_INTERNAL_BASE="http://localhost:${WEBHOOK_PORT}"
      shift 2
      ;;
    --async)
      RUN_ASYNC=1
      shift
      ;;
    --skip-sync)
      RUN_SYNC=0
      shift
      ;;
    --skip-async)
      RUN_ASYNC=0
      shift
      ;;
    --keep-webhook)
      KEEP_WEBHOOK=1
      shift
      ;;
    -h|--help)
      print_help
      exit 0
      ;;
    *)
      echo -e "${RED}未知参数:${NC} $1"
      print_help
      exit 1
      ;;
  esac
done

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

WEBHOOK_PID=""

cleanup() {
  if [[ -n "${WEBHOOK_PID}" ]]; then
    if [[ "${KEEP_WEBHOOK}" -eq 1 ]]; then
      log_info "保留 webhook 服务运行中 (PID: ${WEBHOOK_PID})"
    else
      log_info "关闭 webhook 服务 (PID: ${WEBHOOK_PID})"
      kill "${WEBHOOK_PID}" 2>/dev/null || true
    fi
  fi
}

trap cleanup EXIT INT TERM

check_dependencies() {
  log_header "步骤 1/4: 检查依赖"

  local missing=0

  if command -v node >/dev/null 2>&1; then
    log_success "Node.js: $(node -v)"
  else
    log_error "未检测到 Node.js，请先安装"
    missing=1
  fi

  if command -v npm >/dev/null 2>&1; then
    log_success "npm: $(npm -v)"
  else
    log_error "未检测到 npm，请先安装"
    missing=1
  fi

  if command -v curl >/dev/null 2>&1; then
    log_success "curl 可用"
  else
    log_error "未检测到 curl，请先安装"
    missing=1
  fi

  if [[ "${missing}" -eq 1 ]]; then
    log_error "依赖检查失败，请补齐后再运行"
    exit 1
  fi

  log_success "依赖检查通过"
}

check_health() {
  log_header "步骤 2/4: 生产环境健康检查"
  log_info "API URL: ${API_URL}"

  if ! curl -sSf "${API_URL}/health" >/tmp/prod-health.json; then
    log_error "健康检查失败，无法访问 ${API_URL}/health"
    exit 1
  fi

  log_success "健康检查通过"
  log_info "返回内容: $(cat /tmp/prod-health.json)"
}

run_sync_tests() {
  if [[ "${RUN_SYNC}" -eq 0 ]]; then
    log_warning "跳过同步 API 测试 (--skip-sync)"
    return
  fi

  log_header "步骤 3/4: 运行同步 API 测试"
  if API_URL="${API_URL}" npm run test:api; then
    log_success "同步 API 测试通过"
  else
    log_error "同步 API 测试失败"
    exit 1
  fi
}

start_webhook_service() {
  log_step "启动 webhook 服务 (npm run test:webhook)"
  WEBHOOK_LOG="/tmp/prod-webhook-server.log"
  WEBHOOK_PORT="${WEBHOOK_PORT}" \
  WEBHOOK_URL="${WEBHOOK_URL}" \
  WEBHOOK_INTERNAL_BASE="${WEBHOOK_INTERNAL_BASE}" \
    npm run test:webhook > "${WEBHOOK_LOG}" 2>&1 &
  WEBHOOK_PID=$!

  log_info "Webhook 服务启动中，PID: ${WEBHOOK_PID}"

  # 等待健康检查通过
  local retries=30
  local attempt=0
  while [[ $attempt -lt $retries ]]; do
    if curl -s "${WEBHOOK_INTERNAL_BASE}/health" >/dev/null 2>&1; then
      log_success "Webhook 服务健康检查通过 (${WEBHOOK_INTERNAL_BASE}/health)"
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done

  log_error "Webhook 服务启动失败，请查看日志: ${WEBHOOK_LOG}"
  exit 1
}

run_async_tests() {
  if [[ "${RUN_ASYNC}" -eq 0 ]]; then
    log_warning "跳过异步/Webhook 测试 (--skip-async 或默认行为)"
    return
  fi

  if [[ -z "${WEBHOOK_URL}" ]]; then
    log_error "异步测试需要指定 WEBHOOK_URL (可被 Cloudflare 访问)"
    exit 1
  fi

  log_header "步骤 4/4: 运行异步全链路测试"
  start_webhook_service

  if API_URL="${API_URL}" \
     WEBHOOK_URL="${WEBHOOK_URL}" \
     WEBHOOK_PORT="${WEBHOOK_PORT}" \
     WEBHOOK_INTERNAL_BASE="${WEBHOOK_INTERNAL_BASE}" \
     SKIP_INTERNAL_WEBHOOK=true \
     npm run test:async; then
    log_success "异步全链路测试通过"
  else
    log_error "异步全链路测试失败"
    exit 1
  fi
}

main() {
  log_header "🚀 生产环境巡检"
  echo -e "${CYAN}测试配置:${NC}"
  echo "  • API URL: ${API_URL}"
  echo "  • 运行同步测试: $([[ ${RUN_SYNC} -eq 1 ]] && echo '是' || echo '否')"
  echo "  • 运行异步测试: $([[ ${RUN_ASYNC} -eq 1 ]] && echo '是' || echo '否')"
  if [[ "${RUN_ASYNC}" -eq 1 ]]; then
    echo "  • Webhook URL: ${WEBHOOK_URL}"
    echo "  • 本地监听: ${WEBHOOK_INTERNAL_BASE}"
  fi
  echo ""

  check_dependencies
  check_health
  run_sync_tests
  run_async_tests

  log_header "✅ 生产巡检完成"
  log_success "所有指定测试通过"
  if [[ "${RUN_ASYNC}" -eq 1 ]]; then
    log_info "Webhook 日志: ${WEBHOOK_LOG}"
  fi
}

main "$@"
