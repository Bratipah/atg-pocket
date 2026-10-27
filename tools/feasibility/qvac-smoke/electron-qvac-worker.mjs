import {
  QWEN3_600M_INST_Q4,
  close,
  completion,
  loadModel,
  unloadModel,
} from '@qvac/sdk'

const started = performance.now()
let modelId
let result

try {
  modelId = await loadModel({
    modelSrc: QWEN3_600M_INST_Q4,
    modelConfig: { ctx_size: 1024, device: 'gpu' },
  })
  const loadMs = Math.round(performance.now() - started)
  const inferenceStarted = performance.now()
  const run = completion({
    modelId,
    history: [{ role: 'user', content: 'Reply with a short greeting.' }],
    stream: true,
  })
  let output = ''
  for await (const token of run.tokenStream) output += token
  result = {
    worker: 'electron-utility-process',
    node: process.versions.node,
    qvacInference: 'real local inference complete',
    cachedModelLoadMs: loadMs,
    inferenceMs: Math.round(performance.now() - inferenceStarted),
    response: output.trim().slice(-200),
  }
} catch (error) {
  result = {
    worker: 'electron-utility-process',
    qvacInference: 'failed',
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  }
  process.exitCode = 1
} finally {
  try {
    if (modelId) await unloadModel({ modelId })
    await close()
  } catch (cleanupError) {
    result = {
      worker: 'electron-utility-process',
      qvacInference: 'failed during worker cleanup',
      error:
        cleanupError instanceof Error
          ? `${cleanupError.name}: ${cleanupError.message}`
          : String(cleanupError),
    }
    process.exitCode = 1
  } finally {
    process.parentPort.postMessage(result)
  }
}
