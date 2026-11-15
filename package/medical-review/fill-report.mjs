// 按七章结构出件。每次调用只收一章；生成时必须同轮并行发出七次 fill_report。
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import path from 'node:path'
import { CHAPTER_FORMAT_HINT, CHAPTER_KEYS, mergeAndWriteReport, normalizeChapterKey } from './fill-docx.mjs'
import { relToCase, resolveCaseCwd } from '../case-cwd.mjs'

export const name = 'fill-report'
export const inject = ['tools']
export const Config = z.object({})

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'fill_report',
    description:
      '写入《病历分析报告》的一章，或把已写各章组装为 reports/病历分析报告.md。' +
      '出件前若本会话尚未出现 medical-report-writing 的 skill_content，必须先 skill(medical-report-writing)，等它返回后再同轮并行七次 fill_report；不要与该 skill 同轮并行，也不要跳过它。' +
      '每次调用只传一章：chapter + text。七章必须同轮并行发出七次 fill_report，不要串行等上一章返回，也不要把七章塞进同一次调用。' +
      '正文必须按 medical-report-writing 各章骨架写，禁止把双花括号占位原文写入。禁止 Markdown 表格（不要用竖线 | 做表），用编号段落或连贯叙述。' +
      '引用用【医院名称，文书类型，第N页】，标题已写医院时可简写【文书类型，第N页】。' +
      '标题必须用规定名：一、患者诊疗过程概要；二、病历合规性分析；三、诊断依据审查分析；四、治疗合理性分析；五、知情同意审查结果；六、损害后果；七、因果关系及原因力初判。' +
      '诊疗规范依据禁止引用《劳动能力鉴定》《人体损伤致残程度分级》、GB/T 16180、SF/T 0097；那些只写第六章评残。临床依据必须来自 weknora_clinical / expected_care_plan 的教科书/临床指南/专家共识。' +
      '本会话尚未调用 expected_care_plan 时，不得把第三/四章写成终稿；fill_report 会拦截评残国标并禁止 export。' +
      CHAPTER_FORMAT_HINT +
      '已写过的章不要再传。缺章时工具不会报错，只返回 missing，可对缺章继续并行补写。' +
      '若 next 提示缺少规定小节，只按 medical-report-writing 该章骨架重写缺节的那几章。七章齐且小节齐后 present 该 md。' +
      '不要出鉴定咨询意见书，不要 Write/Edit 终稿文件。',
    parameters: {
      chapter: {
        type: 'string',
        description:
          '本章键名，一次一个：overview / integrity / diagnosis / treatment / consent / damage / causation。' +
          '也可写「一」「患者诊疗过程概要」等中文。finalize=true 时可不填。',
      },
      text: {
        type: 'string',
        description:
          '本章 Markdown，建议 1000–2200 字（概要、治疗、因果可到 2800）。可含或不含 ## 标题（工具会改成规定标题）。' +
          '只写本章。结构必须与 medical-report-writing 该章骨架及工具说明中对应【chapter】段一致。' +
          '禁止 Markdown 表格、禁止把双花括号占位原文写入、禁止把其他章粘进本字段。住院经过禁止项目符号。',
      },
      patient_name: {
        type: 'string',
        description: '患者姓名。写第一章时带上即可，之后可省略。并行写七章时每一章都可带。',
      },
      is_death_case: {
        type: 'string',
        description: '是否死亡病例，true 或 false。写第六章时带上。',
      },
      appendix_guidelines: {
        type: 'string',
        description: '可选。expected_care_plan 返回的已核实临床指南/教科书/共识清单，写入附录 B。禁止把评残国标、工伤致残、人体损伤致残列入。未检索到的不要列。出件时至少在一章（建议 treatment）带上。',
      },
      finalize: {
        type: 'string',
        description: 'true=按已保存各章出终稿。缺章填「（待补充）」。各章未写完不要反复 finalize。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          markdown: { type: 'string' },
          saved: { type: 'string' },
          missing: { type: 'string' },
          next: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          `已更新《${value.title}》：${value.markdown}`,
          `本次写入：${value.saved || '无'}`,
          `仍缺：${value.missing}`,
          value.next,
        ].join('\n'),
      }],
    },
    async execute(args, exec) {
      const cwd = resolveCaseCwd(exec)
      const reportsDir = path.join(cwd, 'reports')
      const patch = {}
      const extras = {}
      if (args.patient_name) patch.patient_name = args.patient_name
      if (args.is_death_case != null && args.is_death_case !== '') {
        extras.is_death_case = args.is_death_case
      }
      if (args.appendix_guidelines && String(args.appendix_guidelines).trim()) {
        extras.appendix_guidelines = String(args.appendix_guidelines).trim()
      }

      const chapter = normalizeChapterKey(args.chapter)
      if (chapter && args.text && String(args.text).trim()) {
        patch[chapter] = args.text
      }
      for (const key of CHAPTER_KEYS) {
        if (args[key] != null && String(args[key]).trim()) patch[key] = args[key]
      }

      const result = await mergeAndWriteReport(reportsDir, patch, extras)
      const saved = result.saved.length ? result.saved.join('、') : '无新增（已用已存章节组装）'
      const missing = result.missing.length ? result.missing.join('、') : '无'
      const gapEntries = Object.entries(result.subheadGaps || {})
      const gapText = gapEntries
        .map(([key, heads]) => `${key}缺${heads.join('、')}`)
        .join('；')
      const clinicalNeed = String(result.clinicalNeed || '').trim()
      let next
      if (clinicalNeed) {
        next = clinicalNeed
        if (result.missing.length) next += ` 仍缺章：${result.missing.join('、')}。`
        if (gapText) next += ` 缺节：${gapText}。`
      } else if (result.missing.length) {
        next = `仍缺：${result.missing.join('、')}。请同轮并行补齐每一缺章：各调一次 fill_report(chapter=..., text=...)。不要串行等返回，不要把多章塞进同一次调用。不要重传已写章节：${result.saved.filter((k) => k !== 'patient_name').join('、') || '见上次'}。`
        if (gapText) {
          next += `已写章节缺少规定小节：${gapText}。补缺章时一并把缺节章按 medical-report-writing 骨架重写。禁止自拟小结、入院诊断、原因力分析、but-for检验。`
        }
      } else if (gapText) {
        next = `七章已齐，但缺少规定小节：${gapText}。请按 medical-report-writing 该章骨架同轮并行只重写上述缺节章（fill_report chapter+text），不要自拟小结/入院诊断/原因力分析/but-for检验/待补项，不要重传结构已合格的章，不要 export。`
      } else {
        next = '七章已齐。接着调用 export_md_to_word（参数可省略）。同一次导出写出「病历分析报告-详细版（患者姓名）.docx」，以及从详细版复制的「病历分析报告（患者姓名）.docx」（只含概要、损害后果、因果关系及原因力初判、备注、附录）。再 present 这两份 docx。不要再 fill_report，不要手写终稿。'
      }

      return {
        title: '病历分析报告',
        markdown: relToCase(cwd, result.mdPath),
        saved,
        missing,
        next,
      }
    },
  }))
}
