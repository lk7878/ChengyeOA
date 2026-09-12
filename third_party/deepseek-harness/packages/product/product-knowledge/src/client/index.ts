/** Native Client surface for product knowledge bases. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import knowledgeRemote from '@deepseek-ai/dsh-product-knowledge/remote'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { KnowledgeLocaleKey } from './locales.ts'
import { en, zh } from './locales.ts'
import { KnowledgeBaseCenter, type KnowledgeClientActions } from './KnowledgeBaseCenter.tsx'
import { KnowledgeNavButton } from './KnowledgeNavButton.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'product.knowledge': KnowledgeLocaleKey }
}

const NS = 'product.knowledge'
const PAGE = 'knowledge-base'
export const inject = ['slots', 'locale', 'layout', 'remote']

function registerUi(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'product-knowledge: dictionaries')
  const value = async <T>(result: Promise<RemoteResult<T>>): Promise<T> => {
    const settled = await result
    if (!settled.ok) throw settled.error
    return settled.value
  }
  const actions: KnowledgeClientActions = {
    topics: async ref => await value(ctx.remote.knowledge.topics({ ref })),
    previewTopic: async (request, signal) => await value(ctx.remote.knowledge.previewTopic(request, signal)),
    saveTopic: async (ref, topic) => await value(ctx.remote.knowledge.saveTopic({ ref, topic })),
    queue: async (ref, documentIds) => await value(ctx.remote.knowledge.queue({
      ref, ...(documentIds === undefined ? {} : { documentIds }),
    })),
    conversation: async (ref, before) => await value(ctx.remote.knowledge.conversation({
      ref, ...(before === undefined ? {} : { before }),
    })),
    close: () => { ctx.layout.closePrimaryPage() },
    list: async () => (await value(ctx.remote.knowledge.list())).knowledgeBases,
    create: async (alias, name) => (await value(ctx.remote.knowledge.create({ alias, name }))).knowledgeBase,
    documents: async ref => (await value(ctx.remote.knowledge.documents({ ref }))).documents,
    importMarkdown: async (ref, name, markdown) => {
      await value(ctx.remote.knowledge.importMarkdown({ ref, name, markdown }))
    },
    importFile: async (ref, file, stageOnly) => await value(ctx.remote.knowledge.importFile({
      ref, fileName: file.name, base64: await fileBase64(file), ...(stageOnly ? { stageOnly } : {}),
    })),
    documentDetail: async (ref, documentId) => await value(ctx.remote.knowledge.documentDetail({ ref, documentId })),
    reprocess: async (ref, documentId) => await value(ctx.remote.knowledge.reprocess({ ref, documentId })),
    search: async (ref, query) => await value(ctx.remote.knowledge.search({ ref, query, limit: 8 })),
    wiki: async (ref, documentId) => await value(ctx.remote.knowledge.wiki({
      ref, ...(documentId === undefined ? {} : { documentId }),
    })),
    graph: async ref => await value(ctx.remote.knowledge.graph({ ref })),
    ask: async (ref, question, mode, onFrame, signal, conversation) => {
      let answer
      for await (const frame of ctx.remote.knowledge.askStream({ ref, question, mode,
        ...(conversation === undefined ? {} : { conversation }),
      }, signal)) {
        onFrame(frame)
        if (frame.type === 'complete') answer = frame.answer
      }
      if (answer === undefined) throw new Error('Knowledge answer stream ended without a completion frame.')
      return answer
    },
    modelSettings: async () => await value(ctx.remote.knowledge.modelSettings()),
    compilerSettings: async () => await value(ctx.remote.knowledge.compilerSettings()),
    saveCompilerSettings: async settings => await value(ctx.remote.knowledge.saveCompilerSettings({ settings })),
    compilation: async request => await value(ctx.remote.knowledge.compilation(request)),
    compileDocument: async (request, signal) => await value(ctx.remote.knowledge.compileDocument(request, signal)),
    reviewVision: async request => await value(ctx.remote.knowledge.reviewVision(request)),
    reviewGap: async request => await value(ctx.remote.knowledge.reviewGap(request)),
    saveModelSettings: async settings => await value(ctx.remote.knowledge.saveModelSettings({ settings })),
    testModel: async signal => await value(ctx.remote.knowledge.testModel({}, signal)),
    semanticIndexStatus: async ref => (await value(ctx.remote.knowledge.semanticIndexStatus({ ref }))).status,
    rebuildSemanticIndex: async (ref, signal) => (await value(ctx.remote.knowledge.rebuildSemanticIndex({ ref }, signal))).status,
    clearSemanticIndex: async ref => (await value(ctx.remote.knowledge.clearSemanticIndex({ ref }))).status,
    setStatus: async (ref, status) => (await value(ctx.remote.knowledge.setStatus({ ref, status }))).knowledgeBase,
    deleteDocument: async (ref, documentId) => {
      await value(ctx.remote.knowledge.deleteDocument({ ref, documentId }))
    },
    deleteKnowledgeBase: async (ref, expectedAlias) => {
      await value(ctx.remote.knowledge.delete({ ref, expectedAlias }))
    },
    backup: async (ref, complete) => await value(ctx.remote.knowledge.backup({ ref, ...(complete ? { complete } : {}) })),
    restore: async json => (await value(ctx.remote.knowledge.restore({ json }))).knowledgeBase,
  }
  ctx.slots.inject('main.page', () => ctx.slots.register({ name: 'main.page', key: PAGE, locale: NS, inject: () => actions }, KnowledgeBaseCenter))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'product-knowledge', order: 10, locale: NS,
    inject: () => ({ open: () => { ctx.layout.openPrimaryPage(PAGE) } }),
  }, KnowledgeNavButton))
}

async function fileBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const blockSize = 32_768
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + blockSize))
  }
  return btoa(binary)
}

export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(knowledgeRemote)
  const ui = ctx.inject(['slots', 'locale', 'layout', 'remote.knowledge'], registerUi)
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote()
  }
}
