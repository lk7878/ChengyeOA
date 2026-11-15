// fill-review.mjs — 伤残鉴定报告审核意见 Word
// 由 disability-report-review skill 在核对标准条文后调用。修改后需重启 Harness。

import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import path from 'node:path'
import { writeReviewPair } from './review-docx.mjs'

export const name = 'fill-review'
export const inject = ['tools']

export const Config = z.object({})

const field = (description) => ({
  type: 'string',
  required: true,
  description,
})

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'fill_review_report',
    description:
      '生成《伤残鉴定报告审核意见》Word。只在已加载 disability-report-review 并完成 weknora_search 后调用一次。' +
      'review_verdict 必须以「结论合理」「部分条款需调整」或「结论不合理」开头。' +
      '不要复述病历和鉴定过程。受伤已满 3 个月且没有其他事项时，risk_notes 填「无。」。' +
      '错别字、日期矛盾等书写错误，以及不改变总判的其他不合理之处，写入 risk_notes，不写入审核结论。书写错误之后必须另起一句「可能为OCR识别问题，请人工进行审查」。' +
      '报告把 GB/T 44893—2024 写成《人身保险伤残评定标准》时，适用标准栏照录原文，审核结论或条款对照必须写明正确名称是《人身保险伤残评定及代码》。' +
      '一份意见书调用一次。subject_name 只写姓名，不要写机构。report_ref 必须写机构和文号。' +
      '同一人文号不同就是另一份，字段全部重写，不要（沿用）。只修改同一文号上一份审核意见时，未改字段才填「（沿用）」。' +
      '文件名含姓名、文号和日期，不覆盖另一份。生成后 present 返回的 docx。',
    parameters: {
      subject_name: field('被鉴定人姓名，只写姓名，不要写机构或文号'),
      report_ref: field('审核对象：鉴定机构，文号。同一人不同文号必须照录，不能省略'),
      applied_standard: field('报告声明的适用标准名称'),
      original_conclusion: field('原鉴定意见中的结论句，不摘分析全文'),
      review_verdict: field('以「结论合理」「部分条款需调整」或「结论不合理」开头，再加最多一句原因'),
      item_review: field('每条伤残一段：原意见等级与条款；审核维持或应调整为某级，一句理由，并标【出处】'),
      risk_notes: field('潜在风险提示。无则填「无。」。鉴定时限、内固定未取出写在这里并写明不影响审核结论。错别字、日期矛盾等书写错误，以及其他不改总判的不合理之处也写在这里。书写错误后必须另起一句「可能为OCR识别问题，请人工进行审查」'),
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
        text: `已生成伤残鉴定报告审核意见：\n- ${value.docx}\n- ${value.markdown}`,
      }],
    },
    async execute(args) {
      const reportsDir = path.join(process.cwd(), 'reports')
      const { docxPath, mdPath } = await writeReviewPair(args, reportsDir)
      return {
        docx: path.relative(process.cwd(), docxPath).replace(/\\/g, '/'),
        markdown: path.relative(process.cwd(), mdPath).replace(/\\/g, '/'),
      }
    },
  }))
}
