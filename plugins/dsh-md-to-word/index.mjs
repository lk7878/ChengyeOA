/**
 * 百佑智业 Markdown → 公文排版 Word。
 * 注册工具 export_md_to_word，供鉴定助手与其它 preset 调用。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-md-to-word'
export const inject = ['tools']

const PLUGIN_ROOT = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.join(PLUGIN_ROOT, 'export_cli.py')
const DEFAULT_ROOTS = ['E:/A/cases', 'E:/A/data', 'E:/A/reports']

export const Config = z.object({
  pythonPath: z.string().default('python'),
})

function resolveCaseCwd(exec) {
  const raw = exec?.agent?.session?.header?.cwd
  if (typeof raw === 'string' && raw.trim()) return path.resolve(raw.trim())
  return process.cwd()
}

function relTo(cwd, absPath) {
  return path.relative(cwd, absPath).replace(/\\/g, '/')
}

function isInsideRoots(file, roots) {
  const abs = path.resolve(file)
  return (roots || []).some((root) => {
    const rel = path.relative(path.resolve(root), abs)
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
  })
}

function resolveUnderCwd(cwd, value, fallbackRel) {
  const raw = String(value || '').trim() || fallbackRel
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(cwd, raw)
}

function runPython(pythonPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath, args, {
      cwd: PLUGIN_ROOT,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

function parseCliJson(stdout) {
  const line = String(stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || ''
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

export function apply(ctx, config = {}) {
  const pythonPath = String(config.pythonPath || 'python').trim() || 'python'
  const outputRoots = Array.isArray(config.outputRoots) && config.outputRoots.length
    ? config.outputRoots
    : DEFAULT_ROOTS

  ctx.tools.register(defineTool({
    name: 'export_md_to_word',
    description:
      '把 Markdown 报告转成公文排版 Word（.docx）。默认读取 reports/病历分析报告.md，' +
      '写出详细版「病历分析报告-详细版（患者姓名）.docx」，并同时复制生成标准版「病历分析报告（患者姓名）.docx」。' +
      '标准版只含：一、患者诊疗过程概要；二、损害后果；三、因果关系及原因力初判；备注；附录。' +
      '表格会摊成编号段落。不要用 convert_file 做这份医疗报告。七章 fill_report 齐后调用一次即可。',
    parameters: {
      input: {
        type: 'string',
        description: '输入 Markdown 路径，相对案件目录或绝对路径。默认 reports/病历分析报告.md。',
      },
      output: {
        type: 'string',
        description: '输出 .docx 路径。默认与输入同名、同目录，扩展名为 .docx。',
      },
      title: {
        type: 'string',
        description: 'Word 文档标题。默认为输入文件名。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'string' },
          word: { type: 'string' },
          markdown: { type: 'string' },
          bytes: { type: 'string' },
          standard_word: { type: 'string' },
          standard_markdown: { type: 'string' },
          standard_bytes: { type: 'string' },
          next: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok === 'true'
          ? `已导出详细版 Word：${value.word}（${value.bytes}）。${value.standard_word ? `标准版：${value.standard_word}（${value.standard_bytes}）。` : ''}${value.next}`
          : `导出失败：${value.next}`,
      }],
    },
    timeoutMs: 120_000,
    async execute(args, exec) {
      const cwd = resolveCaseCwd(exec)
      const input = resolveUnderCwd(cwd, args.input, path.join('reports', '病历分析报告.md'))
      const output = resolveUnderCwd(
        cwd,
        args.output,
        path.join(path.dirname(input), `${path.basename(input, path.extname(input))}.docx`),
      )

      if (!isInsideRoots(input, outputRoots) || !isInsideRoots(output, outputRoots)) {
        return {
          ok: 'false',
          word: '',
          markdown: relTo(cwd, input),
          bytes: '0',
          standard_word: '',
          standard_markdown: '',
          standard_bytes: '0',
          next: `路径必须位于 ${outputRoots.join('、')} 内。`,
        }
      }
      if (!existsSync(input)) {
        return {
          ok: 'false',
          word: '',
          markdown: relTo(cwd, input),
          bytes: '0',
          standard_word: '',
          standard_markdown: '',
          standard_bytes: '0',
          next: `找不到 Markdown：${relTo(cwd, input)}。请先 fill_report 写齐七章。`,
        }
      }
      if (!existsSync(CLI)) {
        return {
          ok: 'false',
          word: '',
          markdown: relTo(cwd, input),
          bytes: '0',
          standard_word: '',
          standard_markdown: '',
          standard_bytes: '0',
          next: `插件 CLI 缺失：${CLI}`,
        }
      }

      await mkdir(path.dirname(output), { recursive: true })
      const title = String(args.title || '').trim() || path.basename(input, path.extname(input))
      let result
      try {
        result = await runPython(pythonPath, [
          '-u', CLI,
          '--input', input,
          '--output', output,
          '--title', title,
        ])
      } catch (err) {
        return {
          ok: 'false',
          word: '',
          markdown: relTo(cwd, input),
          bytes: '0',
          standard_word: '',
          standard_markdown: '',
          standard_bytes: '0',
          next: `无法启动 Python（${pythonPath}）：${err.message}`,
        }
      }

      const payload = parseCliJson(result.stdout)
      if (!payload?.ok) {
        const err = payload?.error || result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`
        return {
          ok: 'false',
          word: payload?.output ? relTo(cwd, payload.output) : '',
          markdown: relTo(cwd, input),
          bytes: '0',
          standard_word: '',
          standard_markdown: '',
          standard_bytes: '0',
          next: String(err).slice(0, 800),
        }
      }

      const standardWord = payload.standard_output ? relTo(cwd, payload.standard_output) : ''
      const standardMd = payload.standard_markdown ? relTo(cwd, payload.standard_markdown) : ''
      return {
        ok: 'true',
        word: relTo(cwd, payload.output || output),
        markdown: relTo(cwd, input),
        bytes: `${payload.bytes || 0} 字节`,
        standard_word: standardWord,
        standard_markdown: standardMd,
        standard_bytes: standardWord ? `${payload.standard_bytes || 0} 字节` : '0',
        next: standardWord
          ? `present 详细版 ${relTo(cwd, payload.output || output)} 与标准版 ${standardWord}。不要用 convert_file 再转一遍。`
          : 'present 该 docx 与对应 md。不要用 convert_file 再转一遍。',
      }
    },
  }))

  console.log('[dsh-md-to-word] loaded: export_md_to_word registered')
}
