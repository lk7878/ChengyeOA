/** Persist standalone Wiki model requests through the existing Harness session protocol. */
import { randomUUID } from 'node:crypto'
import type { GenerateOptions, LlmRuntime, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type SessionStore from '@deepseek-ai/dsh-session'
import type { TurnEndReason } from '@deepseek-ai/dsh-session'

/**
 * Bind a tool-free, user-message-only Wiki caller to durable official request logs.
 * @param llm - official route preparation and dispatch service.
 * @param sessions - official session lifecycle and durability checkpoints.
 * @returns stream service that refuses dispatch without a durable input checkpoint and detaches after flushing output.
 */
export function loggedKnowledgeLlm(llm: Pick<LlmRuntime, 'prepareCall'>, sessions: SessionStore): Pick<LlmRuntime, 'stream'> {
  return {
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      const { messages, system, tools, signal, sessionId: _sessionId, purpose: _purpose, ...config } = options
      const prepared = await llm.prepareCall(config, signal)
      const session = sessions.prepare(SessionId(`wiki-${randomUUID()}`))
      const detach = sessions.enter(session)
      let ended: TurnEndReason = { kind: 'error', error: { code: 'WIKI_MODEL_FAILED', message: 'Wiki model request did not complete.' } }
      let opened = false
      try {
        sessions.announce(session)
        session.append('turn/start', { turn: 1 })
        session.append('step/start', { turn: 1, step: 1 })
        opened = true
        for (const message of messages) {
          if (message.role !== 'user') throw new Error('Wiki one-shot calls require user messages.')
          session.append('user/message', { ...message, role: 'user' }, { surfaceOp: 'append' })
        }
        session.append('request/header', { reason: 'initial', header: {
          config: prepared.config, adapterDefaults: prepared.adapterDefaults,
          ...(system === undefined ? {} : { system }), ...(tools === undefined ? {} : { tools }),
        } })
        if (!await sessions.flush(session)) throw new Error('Wiki model calls require session persistence.')
        signal?.throwIfAborted()
        for await (const chunk of prepared.stream({ ...options, ...prepared.config, sessionId: session.id })) {
          session.append('assistant/chunk', { turn: 1, step: 1, chunk })
          if (chunk.type === 'finish') {
            if (chunk.reason.kind === 'stop') ended = { kind: 'completed' }
            if (chunk.reason.kind === 'max-tokens') ended = { kind: 'max-tokens' }
          }
          yield chunk
        }
      } finally {
        try {
          if (opened) {
            session.append('step/end', { turn: 1, step: 1 })
            if (signal?.aborted === true) {
              ended = signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError'
                ? { kind: 'error', error: { code: 'TIMEOUT', message: 'Wiki model request deadline exceeded.' } }
                : { kind: 'aborted', reason: { kind: 'user' } }
            }
            session.append('turn/end', { turn: 1, reason: ended })
            await sessions.flush(session)
          }
        } finally { detach() }
      }
    },
  }
}
