/**
 * 报告正文后处理：引用、占位符、日期、存活用词，并摊平残留 Markdown 表格。
 */

const PAGE_CITATION_3_RE = /【([^，【】]{1,40})，([^，【】]{1,40})，([^】]{1,80})】/g
const PAGE_CITATION_RE = /【([^，【】]{1,40})，([^，】]{1,80})】/g
const BRACKET_CITE_3_RE = /\[([^,\[\]，]{2,30})[,，]\s*([^,\[\]，]{2,30})[,，]\s*([^\[\]]{1,20})\]/g
const BRACKET_CITE_RE = /\[([^,\[\]，]{2,30})[,，]\s*([^\[\]]{1,20})\]/g
const ISO_DATE_RE = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/
const TABLE_SEP_RE = /^\s*\|?\s*:?-{3,}/

export function normalizePagePart(pagePart) {
  const part = String(pagePart || '').trim()
  if (!part || part === '页码不明' || part === '（输入数据未提供）' || part === '（待补充）') {
    return part || '页码不明'
  }
  if (part === '页码') return '页码不明'
  if (/^第\d+页$/.test(part)) return part
  if (/\d{4}/.test(part) && /[年\-/]/.test(part)) return part
  const pageMatch = part.match(/page[:\s]*(\d+)/i)
  if (pageMatch) return `第${Number(pageMatch[1])}页`
  if (/^\d+$/.test(part)) return `第${Number(part)}页`
  const letter = part.match(/^[Pp](\d+)$/)
  if (letter) return `第${Number(letter[1])}页`
  return part
}

function splitTableRow(line) {
  let raw = String(line || '').trim()
  if (raw.startsWith('|')) raw = raw.slice(1)
  if (raw.endsWith('|')) raw = raw.slice(0, -1)
  return raw.split('|').map((cell) => cell.trim())
}

export function flattenMarkdownTables(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    if (
      i + 1 < lines.length
      && TABLE_ROW_RE.test(lines[i] || '')
      && TABLE_SEP_RE.test(lines[i + 1] || '')
    ) {
      const header = splitTableRow(lines[i])
      i += 2
      const rows = []
      while (i < lines.length && TABLE_ROW_RE.test(lines[i] || '')) {
        rows.push(splitTableRow(lines[i]))
        i += 1
      }
      if (!rows.length) {
        header.forEach((name, idx) => {
          if (name) out.push(`${idx + 1}. ${name}`)
        })
        continue
      }
      rows.forEach((row, ridx) => {
        const parts = []
        row.forEach((cell, cidx) => {
          if (!cell) return
          const label = header[cidx] || `第${cidx + 1}项`
          parts.push(`${label}：${cell}`)
        })
        if (parts.length) out.push(`${ridx + 1}. ${parts.join('；')}。`)
      })
      continue
    }
    out.push(lines[i])
    i += 1
  }
  return out.join('\n')
}

export function normalizePageCitations(text) {
  let out = String(text || '')
  out = out.replace(PAGE_CITATION_3_RE, (_, hospital, doc, page) => {
    return `【${hospital}，${doc}，${normalizePagePart(page)}】`
  })
  out = out.replace(PAGE_CITATION_RE, (_, doc, page) => {
    return `【${doc}，${normalizePagePart(page)}】`
  })
  return out
}

export function formatCnDates(text) {
  return String(text || '').replace(ISO_DATE_RE, (_, y, m, d) => {
    return `${y}年${Number(m)}月${Number(d)}日`
  })
}

export function normalizeChapterStructure(text) {
  let out = String(text || '').replace(/\r\n/g, '\n').trim()
  // 去掉章内重复的一级标题，保留 ## 一、
  out = out.replace(/^#\s+[一二三四五六七]、[^\n]+(?:\n+|$)/gm, '')
  out = out.replace(/^#{1,2}\s+(（[一二三四五六七八]）)/gm, '### $1')
  out = out.replace(/^####\s+(（[一二三四五六七八]）)/gm, '### $1')
  const aliases = [
    [/^#{1,4}\s*（一）\s*入院诊断\s*$/gm, '### （一）主要诊断及依据充分性'],
    [/^#{1,4}\s*（一）\s*医方过错与事实因果\s*$/gm, '### （一）因果关系初步分析'],
    [/^#{1,4}\s*（二）\s*原因力分析\s*$/gm, '### （二）因果关系及原因力初判结果及参考依据'],
    [/^#{1,4}\s*（二）\s*因果关系及原因力初判结果\s*$/gm, '### （二）因果关系及原因力初判结果及参考依据'],
    [/^#{1,4}\s*(?:（[一二]）\s*)?原因力初判\s*$/gm, ''],
    [/^#{1,4}\s*but-for检验\s*$/gim, ''],
    [/^#{1,4}\s*自身因素\s*$/gm, ''],
    [/^#{1,4}\s*（[一二三四五六七八]）\s*小结\s*$/gm, ''],
    [/^#{1,4}\s*小结\s*$/gm, ''],
    [/^#{1,4}\s*（[一二三四五六七八]）\s*待补项\s*$/gm, ''],
    [/^#{1,4}\s*待补项\s*$/gm, ''],
  ]
  for (const [re, to] of aliases) out = out.replace(re, to)
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

export function sanitizeAliveDeathLanguage(text) {
  let out = String(text || '')
  const pairs = [
    ['是患者死亡的根本原因', '是患者损害后果的根本原因'],
    ['与患者死亡或', '与患者损害或'],
    ['与患者死亡及', '与患者损害及'],
    ['对死亡具有', '对损害后果具有'],
    ['过错与患者死亡', '过错与患者损害'],
    ['与患者死亡', '与患者损害'],
    ['发生死亡的严重损害后果', '发生严重损害后果'],
    ['患者死亡损害链条', '患者损害链条'],
  ]
  for (const [a, b] of pairs) out = out.split(a).join(b)
  return out
}

export function postProcessReportText(text, { alive = false, dates = false } = {}) {
  if (text == null) return ''
  let out = String(text)
    .replace(/^\uFEFF/, '')
    .replace(/\u200b|\u2060/g, '')
    .replace(/\u00a0/g, ' ')
  out = flattenMarkdownTables(out)
  out = normalizeChapterStructure(out)
  out = out.replace(/\{\{[^}]{0,80}\}\}/g, '（待补充）')
  out = out.replace(BRACKET_CITE_3_RE, '【$1，$2，$3】')
  out = out.replace(BRACKET_CITE_RE, '【$1，$2】')
  out = normalizePageCitations(out)
  out = out.replace(/^(好的[，,。]|以下是|根据您的|下面是|根据以下)[^\n]*\n/gm, '')
  out = out.replace(/^```(?:markdown)?\s*\n/gm, '')
  out = out.replace(/\n```\s*$/gm, '')
  out = out.replace(/\n{3,}/g, '\n\n')
  if (dates) out = formatCnDates(out)
  if (alive) out = sanitizeAliveDeathLanguage(out)
  return out.trim()
}

export function postProcessStatement(text) {
  let out = postProcessReportText(text, { dates: true })
  out = out.replace(
    /\n#{1,3}\s*[七八九十]+[、.．]?\s*因果关系[^\n]*\n[\s\S]*?(?=\n提交人：)/,
    '\n',
  )
  if (out.includes('提交人：')) {
    out = out.replace(/提交人：[\s\S]*$/, '提交人：\n年   月   日')
  }
  return `${out.trim()}\n`
}

export const APPENDIX_PART_A = [
  '### A. 法规与规范性文件',
  '',
  '1）《中华人民共和国民法典》：医疗损害责任与说明义务条款。',
  '2）《中华人民共和国基本医疗卫生与健康促进法》：患者知情同意权及医疗机构告知义务。',
  '3）《医疗事故处理条例》：医疗机构说明义务与病历管理要求。',
  '4）《医疗机构病历管理规定（2013年修订）》：病历书写和管理基本要求。',
  '5）《临床输血技术规范》：输血前必须取得书面知情同意。',
  '6）麻醉学相关技术规范及国家卫健委病历书写规范文件。',
  '7）《医疗损害司法鉴定指南》（SF/T 0097—2021）。',
].join('\n')

const DISABILITY_SRC_RE = /工伤|职业病致残|劳动能力鉴定|人体损伤致残|GB\/T\s*16180|SF\/T\s*0097/
const DISABILITY_CITE_RE = /《[^》]*(?:劳动能力鉴定|职工工伤与职业病致残|人体损伤致残程度分级)[^》]*》|GB\/T\s*16180[^。；;\n]*|SF\/T\s*0097[^。；;\n]*/g
const CLINICAL_QUERY_BLOCK_RE = /手术指征|诊疗指南|临床指南|专家共识|教科书|应然诊疗|漏诊|多发伤|溶栓|适应证|保守治疗|急诊.{0,8}(检查|规范|处理)|椎体压缩.{0,10}(治疗|手术)|骨折.{0,10}(指南|手术指征|诊疗)/
const CLINICAL_QUERY_ALLOW_RE = /伤残|致残等级|致残程度|劳动能力鉴定|病历书写|知情同意书|知情同意规范|SF\/T|原因力|参与度|鉴定程序/

export function isDisabilityStandardName(text) {
  return DISABILITY_SRC_RE.test(String(text || ''))
}

export function hasDisabilityCitation(text) {
  return /劳动能力鉴定|职工工伤与职业病致残|人体损伤致残|GB\/T\s*16180|SF\/T\s*0097/.test(String(text || ''))
}

export function isClinicalCareQuery(text) {
  const q = String(text || '')
  if (!q.trim()) return false
  if (!CLINICAL_QUERY_BLOCK_RE.test(q)) return false
  if (CLINICAL_QUERY_ALLOW_RE.test(q) && !/手术指征|诊疗指南|临床指南|专家共识/.test(q)) {
    return false
  }
  return true
}

export function sanitizeClinicalChapter(chapter, text) {
  if (chapter !== 'diagnosis' && chapter !== 'treatment') return String(text || '')
  let t = String(text || '')
  DISABILITY_CITE_RE.lastIndex = 0
  if (!DISABILITY_CITE_RE.test(t) && !hasDisabilityCitation(t)) return t
  DISABILITY_CITE_RE.lastIndex = 0
  t = t.replace(DISABILITY_CITE_RE, '')
  t = t.replace(/劳动能力鉴定[^。；\n]*[。；]?/g, '')
  t = t.replace(/人体损伤致残程度分级[^。；\n]*[。；]?/g, '')
  t = t.replace(/职工工伤与职业病致残等级[^。；\n]*[。；]?/g, '')
  return t.replace(/\n{3,}/g, '\n\n').trim()
}

export function clinicalChapterGaps(chapter, text) {
  if (chapter !== 'diagnosis' && chapter !== 'treatment') return []
  const raw = String(text || '')
  if (!raw.trim()) return []
  const gaps = []
  if (hasDisabilityCitation(raw)) {
    gaps.push('诊疗依据禁止评残国标（GB/T 16180、工伤致残、人体损伤致残、SF/T 0097）')
  }
  const slice = chapter === 'treatment'
    ? (raw.split(/诊疗规范依据/)[1] || '')
    : (raw.split(/诊疗指南依据/)[1] || '')
  const probe = slice || raw
  const hasBook = /《[^》]{2,}》/.test(probe)
  const hasCommon = /【医学常识】/.test(probe)
  if (!hasBook && !hasCommon) {
    gaps.push(chapter === 'treatment'
      ? '（5）诊疗规范依据须列出《教科书/临床指南/专家共识》或【医学常识】'
      : '（3）诊疗指南依据须列出《教科书/临床指南/专家共识》或【医学常识】')
  }
  return gaps
}

export function forbiddenHeadingGaps(chapter, text) {
  const raw = String(text || '')
  if (!raw.trim()) return []
  const gaps = []
  if (/^#{1,4}\s*(?:（[一二三四五六七八]）\s*)?小结\s*$/m.test(raw)) {
    gaps.push('禁止自拟「小结」小节')
  }
  if (chapter === 'diagnosis' && /^#{1,4}\s*(?:（[一二三四五六七八]）\s*)?入院诊断\s*$/m.test(raw)) {
    gaps.push('禁止自拟「入院诊断」，应写「### （一）主要诊断及依据充分性」')
  }
  if (chapter === 'causation') {
    if (/^#{1,4}\s*.*but-for检验/im.test(raw) || /^#{1,4}\s*.*原因力分析\s*$/m.test(raw)) {
      gaps.push('禁止自拟「but-for检验」「原因力分析」标题')
    }
  }
  if (chapter === 'damage' && /^#{1,4}\s*(?:（[一二三四五六七八]）\s*)?待补项\s*$/m.test(raw)) {
    gaps.push('禁止自拟「待补项」小节')
  }
  return gaps
}

const CAUSATION_BANDS = ['none', 'slight', 'secondary', 'equal', 'primary', 'all']

const CAUSATION_BAND_NAME = {
  none: '无因果关系',
  slight: '轻微',
  secondary: '次要',
  equal: '同等',
  primary: '主要',
  all: '全部',
}

function causationBandOf(n) {
  if (n >= 0 && n <= 4) return 'none'
  if (n >= 5 && n <= 15) return 'slight'
  if (n >= 16 && n <= 44) return 'secondary'
  if (n >= 45 && n <= 55) return 'equal'
  if (n >= 56 && n <= 95) return 'primary'
  if (n >= 96 && n <= 100) return 'all'
  return ''
}

function causationLabelBands(label) {
  const s = String(label || '').replace(/\s/g, '')
  const order = [
    ['none', /无因果关系|无原因力|无因果/],
    ['slight', /轻微/],
    ['secondary', /次要/],
    ['equal', /同等/],
    ['primary', /主要/],
    ['all', /全部|完全/],
  ]
  return order.filter(([, re]) => re.test(s)).map(([key]) => key)
}

function bandsAdjacent(a, b) {
  const ia = CAUSATION_BANDS.indexOf(a)
  const ib = CAUSATION_BANDS.indexOf(b)
  return ia >= 0 && ib >= 0 && Math.abs(ia - ib) === 1
}

function bandTag(band) {
  if (band === 'none') return '无因果关系'
  return `${CAUSATION_BAND_NAME[band]}原因`
}

function adjacentTag(loBand, hiBand) {
  const [a, b] = CAUSATION_BANDS.indexOf(loBand) < CAUSATION_BANDS.indexOf(hiBand)
    ? [loBand, hiBand]
    : [hiBand, loBand]
  if (a === 'none') return `无因果关系至${CAUSATION_BAND_NAME[b]}原因`
  return `${CAUSATION_BAND_NAME[a]}至${bandTag(b)}`
}

export function causationGradeGaps(text) {
  const raw = String(text || '')
  const gaps = []
  const seen = new Set()
  const push = (msg) => {
    if (!msg || seen.has(msg)) return
    seen.add(msg)
    gaps.push(msg)
  }
  const lines = raw.split(/\n/)
  const pctRe = /约占?\s*(\d+(?:\.\d+)?)\s*[%％]\s*[–—\-~～]\s*(\d+(?:\.\d+)?)\s*[%％](?:\s*[（(]\s*([^）)\n]{1,40})[）)])?/g
  for (const line of lines) {
    if (/未发现明显不当/.test(line) && /约占/.test(line)) {
      push('未发现明显不当的医院不要写成百分比')
    }
    const isSelf = /自身疾病因素/.test(line)
    const isHospital = /整体医疗过错/.test(line)
    pctRe.lastIndex = 0
    let m
    while ((m = pctRe.exec(line))) {
      if (!isSelf && !isHospital) {
        push('原因力百分比只写「自身疾病因素」和「某医院整体医疗过错」，不要按单项过错拆开')
      }
      const lo = Number(m[1])
      const hi = Number(m[2])
      const label = String(m[3] || '').replace(/\s/g, '')
      const loBand = causationBandOf(lo)
      const hiBand = causationBandOf(hi)
      const shown = `${m[1]}%-${m[2]}%`
      if (!loBand || !hiBand || lo > hi) {
        push(`原因力 ${shown} 超出 0%-100%`)
        continue
      }
      const named = causationLabelBands(label)
      if (loBand === hiBand) {
        if (named.length !== 1 || named[0] !== loBand || /至/.test(label)) {
          push(`原因力 ${shown} 应标为（${bandTag(loBand)}）`)
        }
      } else if (bandsAdjacent(loBand, hiBand)) {
        const expect = new Set([loBand, hiBand])
        if (named.length !== 2 || named.some((key) => !expect.has(key)) || !/至/.test(label)) {
          push(`原因力 ${shown} 跨相邻两档，应写成（${adjacentTag(loBand, hiBand)}）`)
        }
      } else {
        push(`原因力 ${shown} 跨越不相邻档位，只允许同一档，或相邻两档（如轻微至次要原因）`)
      }
    }
  }
  if (!/自身疾病因素[（(][^）)\n]{0,200}[）)][：:]\s*约占/.test(raw)) {
    push('（二）须写「自身疾病因素（……）：约占a%-b%（等级）。」')
  }
  if (/存在因果关系/.test(raw) && !/整体医疗过错[：:]\s*约占/.test(raw)) {
    push('已认定过错时，（二）须按医院写「医院名称整体医疗过错：约占a%-b%（等级）。」')
  }
  if (!/综合考虑患者原发疾病及医院的医疗过错/.test(raw)) {
    push('（二）开篇须写「综合考虑患者原发疾病及医院的医疗过错，对损害后果的原因力初步划分如下：」')
  }
  return gaps
}

export function appraisalQualityGaps(chapter, text) {
  const raw = String(text || '')
  if (!raw.trim()) return []
  const gaps = []
  if (chapter === 'diagnosis' || chapter === 'treatment') {
    if (/骨科大手术/.test(raw) && /锁骨|上肢|肱骨|桡骨|尺骨/.test(raw)) {
      gaps.push('不得把「骨科大手术」预防指南直接套用于锁骨/上肢手术，须先核适用范围')
    }
  }
  if (chapter === 'causation') {
    if (!/病历事实/.test(raw) || !/规范要求/.test(raw)) {
      gaps.push('每项过错须写「病历事实—规范要求—过错分析」')
    }
    if (!/约占\s*\d/.test(raw) && !/约占\d/.test(raw)) {
      gaps.push('须同时写原因力六级与百分比（约占 a%–b%）')
    }
    if (!/无因果|轻微|次要|同等|主要|全部|完全/.test(raw)) {
      gaps.push('须写明原因力六级名称')
    }
    gaps.push(...causationGradeGaps(raw))
  }
  return gaps
}

export function clinicalSourceNeed(fields = {}, extras = {}) {
  const diagnosis = String(fields.diagnosis || '')
  const treatment = String(fields.treatment || '')
  if (!diagnosis.trim() && !treatment.trim()) return ''
  if (hasDisabilityCitation(diagnosis) || hasDisabilityCitation(treatment)) {
    return '闸门：第三/四章把评残国标当诊疗依据。请立即 expected_care_plan（本会话若未调用），再只重写 diagnosis、treatment，treatment 须带 appendix_guidelines。禁止 export。'
  }
  const gaps = [
    ...clinicalChapterGaps('diagnosis', diagnosis),
    ...clinicalChapterGaps('treatment', treatment),
  ]
  if (gaps.length) {
    return `闸门：${gaps.join('；')}。先 expected_care_plan，再 fill_report 重写缺依据章节并传入 appendix_guidelines。禁止 export。`
  }
  if (!String(extras.appendix_guidelines || '').trim()) {
    return '闸门：尚未传入 appendix_guidelines。请 fill_report(chapter=treatment, appendix_guidelines=expected_care_plan已核实指南清单)。禁止 export。'
  }
  return ''
}

export function formatAppendixGuidelines(raw) {
  const names = String(raw || '')
    .split(/[\n；;]+/)
    .map((s) => s.replace(/^\s*\d+[)）．、.]\s*/, '').trim())
    .filter(Boolean)
    .filter((s) => !isDisabilityStandardName(s) && !/^本案已检索/.test(s))
  const uniq = []
  for (const name of names) {
    const key = name.replace(/[《》\s]/g, '')
    if (!uniq.some((x) => x.replace(/[《》\s]/g, '') === key)) uniq.push(name)
  }
  if (!uniq.length) {
    return '本案未检索到可列入附录的临床指南或专家共识名称；正文相关依据须标【医学常识】，禁止用评残国标代替。'
  }
  return uniq.map((name, i) => {
    const titled = /《/.test(name) ? name : `《${name}》`
    return `${i + 1}）${titled}`
  }).join('\n')
}

function parseYmd(year, month, day) {
  return { y: Number(year), m: Number(month), d: Number(day) }
}

function formatVisitDate(start, end, withYear) {
  if (!start) return ''
  const one = (date, year) => (year ? `${date.y}年${date.m}月${date.d}日` : `${date.m}月${date.d}日`)
  if (!end || (end.y === start.y && end.m === start.m && end.d === start.d)) return one(start, withYear)
  const endYear = withYear || end.y !== start.y
  return `${one(start, withYear || end.y !== start.y)}至${one(end, endYear)}`
}

function parseOverviewHeader(header) {
  const h = String(header || '').trim()
  const dated = h.match(/^(20\d{2})年(\d{1,2})月(\d{1,2})日\s*(门诊|急诊|住院)?\s*(?:（([^）]{2,80})）)?/)
  if (dated) {
    return {
      start: parseYmd(dated[1], dated[2], dated[3]),
      end: null,
      hospital: (dated[5] || '').replace(/[，,].*$/, '').trim(),
      kind: dated[4] || '',
    }
  }
  const stay = h.match(/第.+?次住院（([^，）]{2,80})[，,]?\s*(20\d{2})年(\d{1,2})月(\d{1,2})日(?:至(20\d{2})年(\d{1,2})月(\d{1,2})日)?/)
  if (stay) {
    return {
      hospital: stay[1].trim(),
      kind: '住院',
      start: parseYmd(stay[2], stay[3], stay[4]),
      end: stay[5] ? parseYmd(stay[5], stay[6], stay[7]) : null,
    }
  }
  return { hospital: '', kind: '', start: null, end: null }
}

function appendixCell(text) {
  return String(text || '')
    .replace(/【[^】]{0,120}】/g, '')
    .replace(/\|/g, '｜')
    .replace(/\s+/g, ' ')
    .trim()
}

function visitInstitution(row) {
  const name = row.hospital || ''
  if (!name) return row.kind || ''
  if (!row.kind) return name
  return `${name}${row.kind}`
}

const OVERVIEW_HEADER_RE = /(?:^|\n)\s*(?:\*\*)?((?:20\d{2}年\d{1,2}月\d{1,2}日\s*(?:门诊|急诊|住院)?（[^）\n]{2,80}）|第\d+次住院（[^）\n]{2,120}）))\s*(?:\*\*)?\s*：\s*/g

export function overviewToAppendixC(overview) {
  const text = String(overview || '').trim()
  if (!text) return '（待根据第一章诊疗过程概要生成）'
  const re = new RegExp(OVERVIEW_HEADER_RE.source, 'g')
  const hits = []
  let m
  while ((m = re.exec(text))) {
    hits.push({ header: m[1].trim(), start: m.index + m[0].length, at: m.index })
  }
  if (!hits.length) {
    const compact = text.replace(/\s+/g, ' ').trim()
    return compact ? compact.slice(0, 1200) : '（待根据第一章诊疗过程概要生成）'
  }
  const rows = []
  for (let i = 0; i < hits.length; i++) {
    const end = i + 1 < hits.length ? hits[i + 1].at : text.length
    const body = appendixCell(text.slice(hits[i].start, end))
    if (!body) continue
    const parsed = parseOverviewHeader(hits[i].header)
    rows.push({ ...parsed, body, header: hits[i].header })
  }
  if (!rows.length) return '（待根据第一章诊疗过程概要生成）'
  const years = new Set()
  for (const row of rows) {
    if (row.start) years.add(row.start.y)
    if (row.end) years.add(row.end.y)
  }
  const multiYear = years.size > 1
  const lines = [
    '| 时间 | 就诊机构 | 主要临床表现 / 检查 / 处理 / 诊断 |',
    '| --- | --- | --- |',
  ]
  for (const row of rows) {
    const when = formatVisitDate(row.start, row.end, multiYear) || appendixCell(row.header)
    const where = visitInstitution(row) || '（就诊机构不详）'
    lines.push(`| ${when} | ${where} | ${row.body} |`)
  }
  return lines.join('\n')
}

function expandPageNumbers(fragment) {
  const pages = []
  const re = /第\s*(\d+)\s*(?:[-–—~到至]\s*(\d+))?\s*页/g
  let match
  while ((match = re.exec(String(fragment || '')))) {
    const start = Number(match[1])
    const end = match[2] ? Number(match[2]) : start
    const lo = Math.min(start, end)
    const hi = Math.max(start, end)
    if (hi - lo > 40) {
      pages.push(lo, hi)
    } else {
      for (let n = lo; n <= hi; n += 1) pages.push(n)
    }
  }
  return pages
}

export function parseCatalogRows(catalogText) {
  const rows = []
  for (const line of String(catalogText || '').split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim())
    if (cells.length < 4) continue
    if (cells[0] === '大类' || /^-+$/.test(cells[0])) continue
    const pages = expandPageNumbers(cells[3])
    if (!pages.length) continue
    rows.push({
      category: cells[0],
      specific: cells[1] || cells[0],
      pages,
    })
  }
  return rows
}

export function extractRecordCitations(text) {
  const cites = []
  const re = /【([^】]{1,240})】/g
  let match
  while ((match = re.exec(String(text || '')))) {
    if (/医学常识|出处：|临床知识库|教科书/.test(match[1]) && !/第\s*\d+\s*页/.test(match[1])) continue
    for (const part of match[1].split(/[；;]/)) {
      const piece = part.trim()
      if (!piece) continue
      const pages = expandPageNumbers(piece)
      const segs = piece.split(/[，,]/).map((seg) => seg.trim()).filter(Boolean)
      let doc = segs[0] || piece
      if (segs.length >= 2 && /页|附件|材料/.test(segs[segs.length - 1])) {
        doc = segs.length >= 3 ? segs[segs.length - 2] : segs[0]
      }
      doc = doc.replace(/第\s*\d+.*$/, '').trim()
      cites.push({ raw: piece, doc, pages })
    }
  }
  return cites
}

function catalogHasCategory(rows, category) {
  return rows.some((row) => row.category === category)
}

function isSecondaryDoc(doc) {
  return /出院记录|出院证明|死亡记录|死亡讨论|死亡病例|死亡诊断/.test(doc)
}

function primaryDocs(cites) {
  return cites.filter((cite) => !isSecondaryDoc(cite.doc)).map((cite) => cite.doc).join(' ')
}

function hasLabSource(cites, rows) {
  const docs = cites.map((cite) => cite.doc).join(' ')
  if (/检验|化验/.test(docs)) return true
  const hasReport = rows.length > 0 && catalogHasCategory(rows, '检验报告')
  if (!hasReport) return primaryDocs(cites).length > 0
  return cites.some((cite) => !isSecondaryDoc(cite.doc) && !/病程/.test(cite.doc))
}

function hasImagingSource(cites, rows) {
  const primary = primaryDocs(cites)
  if (/影像|CT|MRI|MR|超声|彩超|心电|脑电|放射|病理|X线|胸片|PET|B超|检查报告|诊断报告/.test(primary)) {
    return true
  }
  const hasReport = rows.some((row) => row.category === '影像报告' || row.category === '病理报告')
  if (!hasReport) return primary.length > 0
  return false
}

function hasOrderSource(cites, rows) {
  const docs = cites.map((cite) => cite.doc).join(' ')
  if (/医嘱|处方/.test(docs)) return true
  if (/手术|门诊|急诊|麻醉|抢救/.test(primaryDocs(cites))) return true
  const hasOrder = rows.length > 0 && catalogHasCategory(rows, '医嘱记录')
  if (!hasOrder) return primaryDocs(cites).length > 0
  return false
}

function hasAdmissionSource(cites) {
  return /入院|首次病程|病案首页|住院病历|门诊|急诊/.test(primaryDocs(cites))
}

const FACT_RULES = [
  {
    kind: '检验数值',
    test: (sentence) => /[↑↓]|mmol\/?L|μmol|umol\/?L|U\/L|IU\/L|ng\/ml|pg\/ml|×10(?:\^|[⁰¹²³⁴⁵⁶⁷⁸⁹])|g\/L|mg\/L/.test(sentence),
    ok: hasLabSource,
    primary: '检验报告',
    fallback: '卷内未见检验报告单时，改引该数值首次出现的病程或护理页，并写明「卷内未见检验报告单原件」',
  },
  {
    kind: '影像或病理结论',
    test: (sentence) => /CT|MRI|MR|超声|彩超|X线|胸片|PET|心电图|脑电|病理(?!征)/.test(sentence),
    ok: hasImagingSource,
    primary: '影像报告或病理报告',
    fallback: '卷内未见报告单时，改引首次转述该结论的病程页，并写明「卷内未见影像/病理报告原件」',
  },
  {
    kind: '用药、护理级别或监护',
    test: (sentence) => !/出院带药|出院医嘱|带药为/.test(sentence)
      && (/qd|bid|tid|q\d+h|静滴|静脉|注射液|一级护理|二级护理|特级护理|心电监护(?!呈)|吸氧(?!浓度)/.test(sentence)
        || /\d+(?:\.\d+)?\s*(?:mg(?!\/)|μg|ug)\b/.test(sentence)
        || /\d+(?:\.\d+)?\s*g(?!\/)/.test(sentence)
        || /\d+(?:\.\d+)?\s*ml(?!\/)/.test(sentence)),
    ok: hasOrderSource,
    primary: '医嘱记录',
    fallback: '卷内未见医嘱单时，改引首次记载该措施的病程或护理页，并写明「卷内未见医嘱单」',
  },
  {
    kind: '病情首次变化',
    test: (sentence) => /突发|转入重症|意识不清|昏迷|修正诊断/.test(sentence),
    ok: (cites) => /病程|护理|抢救|会诊/.test(primaryDocs(cites)),
    primary: '该事实第一次出现的病程、护理或抢救记录',
    fallback: '不要用出院记录或死亡记录回顾经过',
  },
  {
    kind: '入院诊断或入院查体',
    test: (sentence) => /入院查体|入院诊断|入院时体温/.test(sentence),
    ok: (cites) => hasAdmissionSource(cites),
    primary: '入院记录、病案首页或首次病程',
    fallback: '不要用出院记录或死亡记录代替入院记录',
  },
]

function compactName(text) {
  return String(text || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')
}

function looseName(a, b) {
  const x = compactName(a)
  const y = compactName(b)
  if (!x || !y) return false
  if (x.includes(y) || y.includes(x)) return true
  let prefix = 0
  while (prefix < x.length && prefix < y.length && x[prefix] === y[prefix]) prefix += 1
  let suffix = 0
  while (suffix < x.length && suffix < y.length && x[x.length - 1 - suffix] === y[y.length - 1 - suffix]) suffix += 1
  return prefix >= 2 && suffix >= 2
}

function familyOf(text) {
  const pairs = [
    [/检验|化验/, 'lab'],
    [/医嘱|处方/, 'order'],
    [/护理|体温单/, 'nursing'],
    [/死亡/, 'death'],
    [/出院/, 'discharge'],
    [/影像|CT|MRI|MR|超声|彩超|心电|脑电|放射|X线|胸片|PET|B超|病理/, 'image'],
    [/手术|麻醉|穿刺/, 'procedure'],
    [/知情|同意|告知|通知/, 'consent'],
    [/抢救/, 'rescue'],
    [/会诊/, 'consult'],
    [/入院|病案首页|住院病历/, 'admission'],
    [/病程|查房/, 'course'],
    [/门诊/, 'clinic'],
    [/急诊/, 'er'],
  ]
  const value = String(text || '')
  for (const [re, family] of pairs) {
    if (re.test(value)) return family
  }
  return ''
}

const FAMILY_HOSTS = {
  course: ['procedure', 'consult', 'rescue'],
  consent: ['consent'],
}

function citationFitsRow(doc, row) {
  if (looseName(doc, row.specific) || looseName(doc, row.category)) return true
  const citeFamily = familyOf(doc)
  const rowFamily = familyOf(row.category) || familyOf(row.specific)
  if (!citeFamily || !rowFamily) return true
  if (citeFamily === rowFamily) return true
  return (FAMILY_HOSTS[rowFamily] || []).includes(citeFamily)
}

function clipSentence(sentence) {
  const text = String(sentence || '').replace(/\s+/g, ' ').trim()
  return text.length > 70 ? `${text.slice(0, 70)}…` : text
}

export function overviewSourceGaps(text, catalogText = '') {
  const raw = String(text || '')
  if (!raw.trim()) return []
  const rows = parseCatalogRows(catalogText)
  const gaps = []
  const sentences = raw.split(/(?<=。)/)
  let cursor = 0
  for (const sentence of sentences) {
    const at = cursor
    cursor += sentence.length
    if (gaps.length >= 4) break
    if (/卷内未见/.test(raw.slice(at, at + sentence.length + 24))) continue
    const cites = extractRecordCitations(sentence)
    if (!cites.length) continue
    for (const rule of FACT_RULES) {
      if (!rule.test(sentence)) continue
      if (rule.ok(cites, rows)) continue
      const onlySecondary = cites.every((cite) => isSecondaryDoc(cite.doc))
      const where = onlySecondary ? '不要挂出院记录或死亡记录' : '不要只用病程、入院记录转述'
      gaps.push(`「${clipSentence(sentence)}」的${rule.kind}${where}。应引${rule.primary}。${rule.fallback}。`)
      break
    }
  }
  if (!rows.length) return gaps.slice(0, 4)
  const pageGaps = []
  for (const cite of extractRecordCitations(raw)) {
    if (pageGaps.length >= 4) break
    if (!cite.pages.length) {
      if (/附件|材料|页码不明/.test(cite.raw)) {
        pageGaps.push(`「${cite.raw}」对不上病历页。请改成目录中的【文书，第N页】，先用 parse_records_query 确认这句话写在该页。`)
      }
      continue
    }
    for (const page of cite.pages) {
      const hits = rows.filter((row) => row.pages.includes(page))
      if (!hits.length) {
        pageGaps.push(`【${cite.doc}，第${page}页】在病历目录中没有这一页。请改用 catalog 里的页码。`)
        break
      }
      if (!hits.some((row) => citationFitsRow(cite.doc, row))) {
        const actual = hits.slice(0, 2).map((row) => `${row.specific}（${row.category}）`).join('、')
        pageGaps.push(`【${cite.doc}，第${page}页】在该页找不到。这一页实际是${actual}。请改引目录文书，并核对原文确实记载该事实。`)
        break
      }
    }
  }
  return [...gaps, ...pageGaps].slice(0, 6)
}

export function buildAppendix({ guidelines, overview } = {}) {
  void overview
  return [
    '## 附录',
    '',
    APPENDIX_PART_A,
    '',
    '### B. 诊疗指南与专家共识',
    '',
    formatAppendixGuidelines(guidelines),
    '',
  ].join('\n')
}
