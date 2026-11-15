// fill-period.mjs — 误工、护理、营养期咨询意见 Word
// 由 disability-period-writing skill 在核对标准条文后调用。修改后需重启 Harness。

import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import path from 'node:path'
import { writePeriodPair } from './period-docx.mjs'

export const name = 'fill-period'
export const inject = ['tools']

export const Config = z.object({})

const field = (description) => ({
  type: 'string',
  required: true,
  description,
})

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'fill_period_report',
    description:
      '生成《误工护理营养期咨询意见》Word。先 weknora_search 核对误工期、护理期、营养期条文，再调用一次。' +
      '只写一部标准。opinion 必须同时写明三项期限和【出处】，不得用「若适用」并列。' +
      '标准或伤情不清楚时不要调用。未改字段填「（沿用）」。生成后 present 返回的 docx。',
    parameters: {
      subject_name: field('被鉴定人姓名。未知填（待补充）；沿用上一份填（沿用）'),
      client_name: field('委托单位。未知填（待补充）'),
      materials: field('已收到的病历和影像名称'),
      injury_digest: field('伤情摘要，只写诊断、手术和与三期有关的事实，不编造事故经过'),
      standard: field('检索到的三期标准全称，只一部'),
      opinion: field('误工期、护理期、营养期各写确定期限或标准给出的范围，每项末尾【出处：标准名条款】'),
      notes: field('还缺什么材料。没有则填「无。」'),
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          docx: { type: 'string' },
          markdown: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `已生成误工护理营养期咨询意见：\n- ${value.docx}\n- ${value.markdown}`,
      }],
    },
    async execute(args) {
      const reportsDir = path.join(process.cwd(), 'reports')
      const { docxPath, mdPath } = await writePeriodPair(args, reportsDir)
      return {
        docx: path.relative(process.cwd(), docxPath).replace(/\\/g, '/'),
        markdown: path.relative(process.cwd(), mdPath).replace(/\\/g, '/'),
      }
    },
  }))
}
