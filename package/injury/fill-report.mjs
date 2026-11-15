// fill-report.mjs — 按《百佑智业鉴定咨询意见书》官方 Word 模板出件
//
// 模型填齐字段后调用本工具：复制 template/百佑智业_鉴定咨询意见书模板.docx，
// 替换 {{占位符}}，写入当前案件目录 reports/鉴定咨询意见书.docx（及 .md 预览稿）。
// 修改后需重启 Harness。

import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import path from 'node:path'
import { FIELD_KEYS, FIELD_LABELS, writeReportPair } from './fill-docx.mjs'

export const name = 'fill-report'
export const inject = ['tools']

export const Config = z.object({})

const stringField = (key) => ({
  type: 'string',
  required: true,
  description: FIELD_LABELS[key],
})

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'fill_report',
    description:
      '按官方模板生成《鉴定咨询意见书》。一份只评一部标准，第六章只写一个确定结论（构成某级伤残，或不符合评残前提、不评定伤残等级）。' +
      '标准未确定、写成（待补充）、或用「若适用」并列多部标准/多档等级时，本工具会拒绝出件。' +
      '《人体损伤程度鉴定标准》不能写入本意见。GB/T 44893—2024 须写《人身保险伤残评定及代码》。' +
      '只改委托单位、身份证等个别内容时，未改字段填「（沿用）」。空的身份信息会写成（待补充）。' +
      '文件名含被鉴定人姓名和日期，不覆盖上一份。生成后 present 返回的 docx。告诉用户这是咨询意见，不是司法鉴定意见书。',
    parameters: Object.fromEntries(FIELD_KEYS.map((k) => [k, stringField(k)])),
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
        text: `已按百佑智业模板生成：\n- ${value.docx}\n- ${value.markdown}`,
      }],
    },
    async execute(args) {
      const reportsDir = path.join(process.cwd(), 'reports')
      const { docxPath, mdPath } = await writeReportPair(args, reportsDir)
      return {
        docx: path.relative(process.cwd(), docxPath).replace(/\\/g, '/'),
        markdown: path.relative(process.cwd(), mdPath).replace(/\\/g, '/'),
      }
    },
  }))
}
