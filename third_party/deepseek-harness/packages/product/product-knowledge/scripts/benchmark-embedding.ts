/** One-shot F005 compatibility benchmark for the first local multilingual embedding candidate. */

import { performance } from 'node:perf_hooks'
import { env, pipeline } from '@huggingface/transformers'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

const MODEL = 'intfloat/multilingual-e5-small'
const REVISION = '614241f622f53c4eeff9890bdc4f31cfecc418b3'
const CACHE = dshHomePath('product', 'knowledge', 'embedding-models')

env.cacheDir = CACHE
env.allowLocalModels = true
env.allowRemoteModels = true

const rssBefore = process.memoryUsage.rss()
const coldStarted = performance.now()
const online = await pipeline('feature-extraction', MODEL, {
  revision: REVISION,
  dtype: 'fp32',
  model_file_name: 'model',
})
const coldLoadMs = performance.now() - coldStarted

const texts = [
  'query: 扫描论文如何在本地进行文字识别？',
  'passage: 本地 PaddleOCR 只处理缺少有效文本层的扫描页面。',
  'passage: 金融市场今天出现大幅波动。',
]
const firstStarted = performance.now()
const first = await online(texts, { pooling: 'mean', normalize: true })
const firstBatchMs = performance.now() - firstStarted
const vectors = first.tolist() as number[][]
await online.dispose()

env.allowRemoteModels = false
const offlineStarted = performance.now()
const offline = await pipeline('feature-extraction', MODEL, {
  revision: REVISION,
  dtype: 'fp32',
  model_file_name: 'model',
})
const offlineLoadMs = performance.now() - offlineStarted
const offlineOutput = await offline(texts.slice(0, 2), { pooling: 'mean', normalize: true })
const offlineVectors = offlineOutput.tolist() as number[][]
await offline.dispose()

const result = {
  model: MODEL,
  revision: REVISION,
  artifact: 'onnx/model.onnx',
  dtype: 'fp32',
  cache: CACHE,
  dimensions: vectors[0]?.length ?? 0,
  coldLoadMs: Math.round(coldLoadMs),
  firstBatchMs: Math.round(firstBatchMs),
  offlineReloadMs: Math.round(offlineLoadMs),
  rssIncreaseMiB: Math.round((process.memoryUsage.rss() - rssBefore) / 1_048_576),
  relatedCosine: roundedCosine(vectors[0] ?? [], vectors[1] ?? []),
  unrelatedCosine: roundedCosine(vectors[0] ?? [], vectors[2] ?? []),
  offlineMatchesOnline: approximatelyEqual(vectors[0] ?? [], offlineVectors[0] ?? []),
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)

function roundedCosine(left: readonly number[], right: readonly number[]): number {
  return Math.round(left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0) * 1_000_000) / 1_000_000
}

function approximatelyEqual(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => Math.abs(value - (right[index] ?? 0)) < 1e-6)
}
