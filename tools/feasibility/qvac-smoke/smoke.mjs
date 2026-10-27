import os from 'node:os'
import { readdir, readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import {
  QWEN3_600M_INST_Q4,
  assessModelFit,
  close,
  completion,
  downloadAsset,
  loadModel,
  unloadModel,
} from '@qvac/sdk'

const mode = process.argv[2] ?? 'prepare'
if (!['prepare', 'offline'].includes(mode)) {
  throw new Error('Usage: node smoke.mjs [prepare|offline]')
}

const started = performance.now()
let peakRss = process.memoryUsage().rss
let peakProcessTreeRss = 0
let lowestAvailableMemory = os.availableMemory?.() ?? os.freemem()
let sampling = false

async function sampleMemory() {
  if (sampling) return
  sampling = true
  try {
    const pids = (await readdir('/proc')).filter((entry) => /^\d+$/.test(entry))
    const processRows = await Promise.all(
      pids.map(async (pid) => {
        try {
          const status = await readFile(`/proc/${pid}/status`, 'utf8')
          const parent = Number(status.match(/^PPid:\s+(\d+)$/m)?.[1] ?? -1)
          const rss = Number(status.match(/^VmRSS:\s+(\d+)\s+kB$/m)?.[1] ?? 0) * 1024
          return { pid: Number(pid), parent, rss }
        } catch {
          return null
        }
      }),
    )
    const rows = processRows.filter(Boolean)
    const descendants = new Map()
    for (const row of rows) {
      const children = descendants.get(row.parent) ?? []
      children.push(row)
      descendants.set(row.parent, children)
    }
    const treeRss = (parentPid) =>
      (descendants.get(parentPid) ?? []).reduce(
        (sum, child) => sum + child.rss + treeRss(child.pid),
        0,
      )
    peakProcessTreeRss = Math.max(peakProcessTreeRss, treeRss(process.pid))
    peakRss = Math.max(peakRss, process.memoryUsage().rss)
    lowestAvailableMemory = Math.min(
      lowestAvailableMemory,
      os.availableMemory?.() ?? os.freemem(),
    )
  } finally {
    sampling = false
  }
}

const sampler = setInterval(() => {
  void sampleMemory()
}, 500)
void sampleMemory()

const memory = () => ({
  rssBytes: process.memoryUsage().rss,
  heapUsedBytes: process.memoryUsage().heapUsed,
  hostAvailableBytes: os.availableMemory?.() ?? os.freemem(),
})

let modelId
try {
  let fit = null
  let fitMs = null
  if (mode === 'prepare') {
    const fitStarted = performance.now()
    fit = await assessModelFit({
      models: [
        {
          modelSrc: QWEN3_600M_INST_Q4,
          modelConfig: { ctx_size: 1024, device: 'gpu' },
        },
      ],
    })
    fitMs = Math.round(performance.now() - fitStarted)
  }

  let downloadMs = null
  if (mode === 'prepare') {
    const downloadStarted = performance.now()
    let lastDownloadReport = -10
    await downloadAsset({
      assetSrc: QWEN3_600M_INST_Q4,
      onProgress: (progress) => {
        if (
          progress.percentage < 100 &&
          progress.percentage - lastDownloadReport < 10
        ) return
        lastDownloadReport = progress.percentage
        process.stderr.write(
          `download ${progress.percentage.toFixed(1)}% ` +
            `${progress.downloaded}/${progress.total} bytes\n`,
        )
      },
    })
    downloadMs = Math.round(performance.now() - downloadStarted)
  }

  const loadStarted = performance.now()
  modelId = await loadModel({
    modelSrc: QWEN3_600M_INST_Q4,
    modelConfig: { ctx_size: 1024, device: 'gpu' },
    onProgress: (progress) => {
      process.stderr.write(
        `load ${progress.percentage.toFixed(1)}% ` +
          `${progress.downloaded}/${progress.total} bytes\n`,
      )
    },
  })
  const loadMs = Math.round(performance.now() - loadStarted)

  const inferenceStarted = performance.now()
  let firstTokenMs = null
  let response = ''
  const run = completion({
    modelId,
    history: [
      {
        role: 'user',
        content: 'Reply exactly with: QVAC local inference is running.',
      },
    ],
    stream: true,
  })
  for await (const token of run.tokenStream) {
    if (firstTokenMs === null) firstTokenMs = Math.round(performance.now() - inferenceStarted)
    response += token
  }
  const inferenceMs = Math.round(performance.now() - inferenceStarted)

  process.stdout.write(
    `${JSON.stringify(
      {
        mode,
        model: 'QWEN3_600M_INST_Q4',
        fit,
        fitMs,
        downloadMs,
        loadMs,
        firstTokenMs,
        inferenceMs,
        response,
        memoryAtInferenceEnd: {
          ...memory(),
          processTreeRssBytes: peakProcessTreeRss,
        },
        peakRssBytes: peakRss,
        peakProcessTreeRssBytes: peakProcessTreeRss,
        lowestHostAvailableBytes: lowestAvailableMemory,
        totalMs: Math.round(performance.now() - started),
      },
      null,
      2,
    )}\n`,
  )
} finally {
  clearInterval(sampler)
  if (modelId) await unloadModel({ modelId })
  await close()
}
