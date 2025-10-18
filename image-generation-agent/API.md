fetch('https://image-generation-agent.limuran818.workers.dev/api/generate-image', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    task_id: 'console_test_' + Date.now(),
    prompt: 'A kawaii corgi astronaut floating in space, watercolor illustration',
    count: 1,
    options: {
      size: '1024x1024',
      quality: 'standard',
    },
  }),
})
  .then(async (res) => {
    if (!res.ok) {
      throw new Error(await res.text());
    }
    return res.json();
  })
  .then((data) => {
    console.log('✅ Generation success:', data);
    data.images.forEach((img) => console.log('Image URL:', img.url));
  })
  .catch((err) => console.error('❌ Generation failed:', err));



  curl -X POST \
  https://image-generation-agent.limuran818.workers.dev/api/generate-image \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "cli_test_001",
    "prompt": "A futuristic city skyline at sunset, digital art",
    "count": 1
  }'

  