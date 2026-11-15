// 可选：陈述意见书。默认不出；仅用户明确要求时调用。
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { postProcessStatement } from './report-text.mjs'
import { relToCase, resolveCaseCwd } from '../case-cwd.mjs'

export const name = 'fill-statement'
export const inject = ['tools']
export const Config = z.object({})

function safeHospital(name) {
  return String(name || '').replace(/[\\/:*?"<>|]/g, '_')
}

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'fill_statement',
    description:
      '生成《医疗损害鉴定陈述意见书》Markdown。仅当用户明确要求陈述意见书、听证意见或患方/医方陈述时调用；默认鉴定任务只用 fill_report。' +
      '输入必须是已写成的病历分析报告，禁止从原始病历重新解析。' +
      '不把分析稿每一项问题机械搬入；禁止独立「因果关系与原因力」专章；禁止承诺赔偿比例。' +
      '多家医院分别调用本工具。生成后 present 对应 md。',
    parameters: {
      patient_name: { type: 'string', required: true, description: '患者姓名' },
      hospital_name: { type: 'string', required: true, description: '本份文书评价的医疗机构，过错主体只写这一家' },
      stance: { type: 'string', description: '患方 或 医方，默认患方' },
      body: {
        type: 'string',
        required: true,
        description:
          '陈述意见书正文 Markdown。第一行 `# 姓名案`，第二行 `## 陈述意见书`，称呼「各位鉴定人、临床医学专家：」。' +
          '开篇一段写整体诊疗过程（即使只评一家医院），再写「现患方认为，××医院在诊疗过程中存在以下过错：」（医方则作对应答辩表述）。' +
          '一级标题 `### 一、……` 即结论；二级用（一）（二）连续段落。事实后附【文书类型，第N页】。' +
          '过错写完后用指定收束段+「提交人： / 年   月   日」，不要另开因果专章。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          markdown: { type: 'string' },
          hospital_file: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `已生成陈述意见书（可选文书）：\n- ${value.markdown}\n- ${value.hospital_file}`,
      }],
    },
    async execute(args, exec) {
      const cwd = resolveCaseCwd(exec)
      const reportsDir = path.join(cwd, 'reports')
      await mkdir(reportsDir, { recursive: true })
      const cleaned = postProcessStatement(args.body)
      const hospital = safeHospital(args.hospital_name || '医院')
      const latest = path.join(reportsDir, '陈述意见书.md')
      const perHospital = path.join(reportsDir, `statement_${hospital}.md`)
      await writeFile(latest, cleaned, 'utf8')
      await writeFile(perHospital, cleaned, 'utf8')
      return { markdown: relToCase(cwd, latest), hospital_file: relToCase(cwd, perHospital) }
    },
  }))
}
