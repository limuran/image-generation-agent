/**
 * 简单的API测试脚本
 * 用法: node test/api-test.js
 */

const API_URL = process.env.API_URL || 'http://localhost:4111'

async function testHealthCheck() {
  console.log('\n🔍 测试 1: 健康检查...')
  try {
    const response = await fetch(`${API_URL}/health`)
    const data = await response.json()
    console.log('✅ 健康检查通过:', data)
    return true
  } catch (error) {
    console.error('❌ 健康检查失败:', error.message)
    return false
  }
}

async function testSingleImage() {
  console.log('\n🔍 测试 2: 生成单张图片...')
  try {
    const startTime = Date.now()
    const response = await fetch(`${API_URL}/api/generate-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: `test_${Date.now()}`,
        prompt: 'a cute cat playing with a ball of yarn',
        count: 1
      })
    })

    const data = await response.json()
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)

    if (data.success) {
      console.log('✅ 单张图片生成成功!')
      console.log(`   耗时: ${elapsed}s`)
      console.log(`   图片URL: ${data.images[0]?.url}`)
      return true
    } else {
      console.error('❌ 生成失败:', data.error)
      return false
    }
  } catch (error) {
    console.error('❌ 请求失败:', error.message)
    return false
  }
}

async function testMultipleImages() {
  console.log('\n🔍 测试 3: 生成多张图片...')
  try {
    const startTime = Date.now()
    const response = await fetch(`${API_URL}/api/generate-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: `test_multi_${Date.now()}`,
        prompt: 'abstract geometric art with vibrant colors',
        count: 3,
        options: {
          size: '1024x1024',
          quality: 'standard'
        }
      })
    })

    const data = await response.json()
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)

    if (data.success) {
      console.log('✅ 多张图片生成成功!')
      console.log(`   耗时: ${elapsed}s`)
      console.log(`   生成数量: ${data.total_images}`)
      data.images.forEach((img, i) => {
        console.log(`   图片 ${i + 1}: ${img.url}`)
      })
      return true
    } else {
      console.error('❌ 生成失败:', data.error)
      return false
    }
  } catch (error) {
    console.error('❌ 请求失败:', error.message)
    return false
  }
}

async function testErrorHandling() {
  console.log('\n🔍 测试 4: 错误处理...')

  // 测试缺少参数
  try {
    const response = await fetch(`${API_URL}/api/generate-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'test'
        // 缺少 task_id
      })
    })

    const data = await response.json()
    if (!data.success && data.error?.code === 'MISSING_PARAMETERS') {
      console.log('✅ 参数验证正常工作')
      return true
    } else {
      console.error('❌ 参数验证未正常工作')
      return false
    }
  } catch (error) {
    console.error('❌ 测试失败:', error.message)
    return false
  }
}

async function testInvalidCount() {
  console.log('\n🔍 测试 5: 无效count值...')
  try {
    const response = await fetch(`${API_URL}/api/generate-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: 'test_invalid',
        prompt: 'test',
        count: 10 // 超过限制
      })
    })

    const data = await response.json()
    if (!data.success && data.error?.code === 'INVALID_COUNT') {
      console.log('✅ Count验证正常工作')
      return true
    } else {
      console.error('❌ Count验证未正常工作')
      return false
    }
  } catch (error) {
    console.error('❌ 测试失败:', error.message)
    return false
  }
}

async function runAllTests() {
  console.log('🚀 开始API测试...')
  console.log(`📍 API地址: ${API_URL}`)

  const results = []

  // 运行所有测试
  results.push(await testHealthCheck())
  results.push(await testSingleImage())

  // 可选：如果想测试多图生成（会比较慢）
  // results.push(await testMultipleImages());

  results.push(await testErrorHandling())
  results.push(await testInvalidCount())

  // 统计结果
  const passed = results.filter((r) => r).length
  const total = results.length

  console.log('\n' + '='.repeat(50))
  console.log(`📊 测试结果: ${passed}/${total} 通过`)
  console.log('='.repeat(50))

  if (passed === total) {
    console.log('🎉 所有测试通过！')
    process.exit(0)
  } else {
    console.log('⚠️  部分测试失败')
    process.exit(1)
  }
}

// 运行测试
runAllTests().catch((error) => {
  console.error('💥 测试运行失败:', error)
  process.exit(1)
})
