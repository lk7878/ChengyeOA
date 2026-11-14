/** Local text-embedding provider and deterministic rank-fusion helpers for F005. */

import { pipeline } from '@huggingface/transformers'
import type { FeatureExtractionPipeline } from '@huggingface/transformers'

/** Local embedding engine consumed by the product knowledge store. */
export interface KnowledgeEmbeddingProvider {
  readonly model: string
  readonly revision: string
  readonly dimensions: number
  /**
   * Embed one bounded batch in input order.
   * @param texts - query- or passage-prefixed text projections.
   * @param signal - caller cancellation observed before and after native inference.
   * @returns normalized float vectors in input order.
   */
  embed(texts: readonly string[], signal?: AbortSignal): Promise<readonly Float32Array[]>
  /** Release a loaded local inference session. */
  close(): void
}

/** Fully pinned local Transformers.js embedding configuration. */
export interface LocalEmbeddingConfig {
  readonly model: string
  readonly revision: string
  readonly cachePath: string
  readonly modelFileName: string
  readonly dtype: 'fp32' | 'fp16' | 'q8' | 'q4'
  readonly dimensions: number
}

/** Offline-only ONNX embedding provider backed by a preinstalled local model cache. */
export class LocalTransformersEmbeddingProvider implements KnowledgeEmbeddingProvider {
  readonly model: string
  readonly revision: string
  readonly dimensions: number
  readonly #config: LocalEmbeddingConfig
  #extractor: Promise<FeatureExtractionPipeline> | undefined

  constructor(config: LocalEmbeddingConfig) {
    this.#config = config
    this.model = config.model
    this.revision = config.revision
    this.dimensions = config.dimensions
  }

  async embed(texts: readonly string[], signal?: AbortSignal): Promise<readonly Float32Array[]> {
    if (texts.length === 0) return []
    signal?.throwIfAborted()
    const extractor = await this.#load()
    signal?.throwIfAborted()
    const tensor = await extractor([...texts], { pooling: 'mean', normalize: true })
    signal?.throwIfAborted()
    const rows = tensor.tolist()
    if (!Array.isArray(rows) || rows.length !== texts.length) throw new Error('Embedding provider returned an invalid batch.')
    return rows.map(candidate => validatedVector(candidate, this.dimensions))
  }

  close(): void {
    const extractor = this.#extractor
    this.#extractor = undefined
    if (extractor !== undefined) void extractor.then(value => value.dispose()).catch(() => {})
  }

  #load(): Promise<FeatureExtractionPipeline> {
    this.#extractor ??= pipeline('feature-extraction', this.#config.model, {
      revision: this.#config.revision,
      dtype: this.#config.dtype,
      model_file_name: this.#config.modelFileName,
      cache_dir: this.#config.cachePath,
      local_files_only: true,
    })
    return this.#extractor
  }
}

/** One ranked identity from an independent candidate source. */
export interface RankedCandidate<T> {
  readonly id: string
  readonly value: T
}

/**
 * Fuse independent rankings with reciprocal-rank fusion and stable identity ties.
 * @param rankings - best-first candidate lists from independent retrievers.
 * @param rankConstant - positive denominator offset controlling tail influence.
 * @returns unique values ordered by fused score and stable id.
 */
export function reciprocalRankFusion<T>(
  rankings: readonly (readonly RankedCandidate<T>[])[],
  rankConstant: number,
): T[] {
  const candidates = new Map<string, { value: T; score: number }>()
  for (const ranking of rankings) {
    ranking.forEach((candidate, index) => {
      const current = candidates.get(candidate.id)
      const contribution = 1 / (rankConstant + index + 1)
      candidates.set(candidate.id, {
        value: current?.value ?? candidate.value,
        score: (current?.score ?? 0) + contribution,
      })
    })
  }
  return [...candidates.entries()]
    .sort((left, right) => right[1].score - left[1].score || left[0].localeCompare(right[0]))
    .map(([, candidate]) => candidate.value)
}

/**
 * Encode one normalized vector into a portable little-endian SQLite BLOB.
 * @param vector - normalized embedding coordinates.
 * @returns independently allocated little-endian bytes.
 */
export function encodeVector(vector: Float32Array): Uint8Array {
  const bytes = new Uint8Array(vector.length * Float32Array.BYTES_PER_ELEMENT)
  const view = new DataView(bytes.buffer)
  vector.forEach((value, index) => {
    view.setFloat32(index * Float32Array.BYTES_PER_ELEMENT, value, true)
  })
  return bytes
}

/**
 * Decode one portable little-endian SQLite vector BLOB, rejecting an incorrect byte length.
 * @param bytes - stored vector bytes.
 * @param dimensions - expected coordinate count.
 * @returns independently allocated coordinates.
 */
export function decodeVector(bytes: Uint8Array, dimensions: number): Float32Array {
  if (bytes.byteLength !== dimensions * Float32Array.BYTES_PER_ELEMENT) {
    throw new Error(`Embedding vector has ${bytes.byteLength} bytes; expected ${dimensions * Float32Array.BYTES_PER_ELEMENT}.`)
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return Float32Array.from({ length: dimensions }, (_, index) => view.getFloat32(index * Float32Array.BYTES_PER_ELEMENT, true))
}

/**
 * Dot product for already normalized vectors; mismatched dimensions throw.
 * @param left - normalized query coordinates.
 * @param right - normalized passage coordinates.
 * @returns their cosine similarity.
 */
export function normalizedCosine(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length) throw new Error('Embedding vectors have different dimensions.')
  let score = 0
  for (let index = 0; index < left.length; index += 1) score += (left[index] ?? 0) * (right[index] ?? 0)
  return score
}

function validatedVector(candidate: unknown, dimensions: number): Float32Array {
  if (!Array.isArray(candidate) || candidate.length !== dimensions
    || candidate.some(value => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error(`Embedding provider must return ${dimensions} finite dimensions.`)
  }
  return Float32Array.from(candidate)
}
