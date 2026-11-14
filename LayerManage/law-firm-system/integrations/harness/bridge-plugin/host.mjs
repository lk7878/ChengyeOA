// Independent OA extension; knowledge persistence remains owned by Harness.
export const inject = ['knowledgeBases'];
export function apply(ctx) {
  ctx.knowledgeBases.create({ alias: 'chengye-personal', name: '我的法律知识库' });
}
