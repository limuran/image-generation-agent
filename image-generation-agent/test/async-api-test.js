/**
 * 异步 API 测试示例
 *
 * 使用方法:
 * 1. 启动你的 webhook 接收服务（监听 /agents/putArtifacts）
 * 2. 修改下面的 WEBHOOK_URL 为你的实际地址
 * 3. 运行: node test/async-api-test.js
 */

const AGENT_URL = 'http://localhost:8787/api/generate-image' // 或你的生产环境地址
const WEBHOOK_URL = 'http://localhost:3000/agents/putArtifacts' // 修改为你的实际 webhook 地址

async function testAsyncImageGeneration() {
  const task_id = `test_${Date.now()}`

  console.log('📤 发送异步任务请求...')
  console.log('Task ID:', task_id)
  console.log('Webhook URL:', WEBHOOK_URL)

  try {
    // 1. 创建任务
    const response = await fetch(AGENT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        task_id: task_id,
        prompt: 'A beautiful sunset over mountains',
        webhook_url: WEBHOOK_URL,
        count: 2 // 生成 2 张图片
      })
    })

    const data = await response.json()

    if (response.status === 202) {
      console.log('✅ 任务创建成功！')
      console.log('返回数据:', JSON.stringify(data, null, 2))
      console.log('\n⏳ 任务正在后台执行...')
      console.log('💡 请检查你的 webhook 服务日志，等待回调')
      console.log(`📝 预期回调格式:`)
      console.log(
        JSON.stringify(
          {
            task_id: task_id,
            generation_time: 15.5,
            artifacts: [
              {
                index: 1,
                url: 'https://pub-xxx.r2.dev/images/xxx.png',
                size_bytes: 123456
              },
              {
                index: 2,
                url: 'https://pub-xxx.r2.dev/images/xxx.png',
                size_bytes: 123456
              }
            ]
          },
          null,
          2
        )
      )
    } else {
      console.error('❌ 任务创建失败')
      console.error('状态码:', response.status)
      console.error('响应:', JSON.stringify(data, null, 2))
    }
  } catch (error) {
    console.error('❌ 请求失败:', error.message)
  }
}

// 模拟 Webhook 接收服务（仅用于本地测试）
async function startMockWebhookServer() {
  const http = await import('http')

  const server = http.default.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/agents/putArtifacts') {
      let body = ''

      req.on('data', (chunk) => {
        body += chunk.toString()
      })

      req.on('end', () => {
        console.log('\n🔔 收到 Webhook 回调！')
        console.log('时间:', new Date().toISOString())
        console.log('数据:', body)

        try {
          const data = JSON.parse(body)
          console.log('\n✅ 解析成功:')
          console.log('- Task ID:', data.task_id)
          console.log('- 生成时间:', data.generation_time, '秒')
          console.log('- 图片数量:', data.artifacts?.length || 0)

          if (data.artifacts && data.artifacts.length > 0) {
            console.log('\n🖼️  生成的图片:')
            data.artifacts.forEach((artifact) => {
              console.log(
                `  [${artifact.index}] ${artifact.url.substring(0, 80)}...`
              )
              console.log(
                `      大小: ${(artifact.size_bytes / 1024).toFixed(2)} KB`
              )
            })
          }

          if (data.error) {
            console.log('\n⚠️  错误信息:', data.error)
          }
        } catch (e) {
          console.error('❌ JSON 解析失败:', e.message)
        }

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
      })
    } else {
      res.writeHead(404)
      res.end('Not Found')
    }
  })

  server.listen(3000, () => {
    console.log('🎯 模拟 Webhook 服务已启动')
    console.log('监听地址: http://localhost:3000/agents/putArtifacts')
    console.log('请修改测试代码中的 WEBHOOK_URL 为上述地址\n')
  })
}

// 主函数
async function main() {
  const args = process.argv.slice(2)

  if (args.includes('--mock-webhook')) {
    // 启动模拟 webhook 服务
    startMockWebhookServer()
  } else {
    // 执行测试
    await testAsyncImageGeneration()
  }
}

main()
