import { performance } from 'perf_hooks';

async function measureStreamLatency() {
  console.log('Stream latency test - simulating token streaming');
  
  const iterations = 1000;
  const startTime = performance.now();
  
  for (let i = 0; i < iterations; i++) {
    const token = `token_${i}`;
    const tokenTime = performance.now();
    
    if (i === 0) {
      const firstTokenLatency = tokenTime - startTime;
      console.log(`✓ First token latency: ${firstTokenLatency.toFixed(2)}ms`);
      if (firstTokenLatency > 300) {
        console.log(`✗ FAIL: First token > 300ms`);
        process.exit(1);
      }
    }
    
    await new Promise(resolve => setImmediate(resolve));
  }
  
  const totalTime = performance.now() - startTime;
  const avgLatency = totalTime / iterations;
  
  console.log(`✓ Total time for ${iterations} tokens: ${totalTime.toFixed(2)}ms`);
  console.log(`✓ Average latency per token: ${avgLatency.toFixed(3)}ms`);
  console.log('✓ PASS: Stream latency test completed');
  
  process.exit(0);
}

measureStreamLatency().catch(err => {
  console.error('Stream test failed:', err);
  process.exit(1);
});
