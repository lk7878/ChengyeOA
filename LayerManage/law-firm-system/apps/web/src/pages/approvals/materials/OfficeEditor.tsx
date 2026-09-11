import { useEffect, useState } from 'react';
import { Alert, Button, Input, InputNumber, Pagination, Select, Space, Spin, message } from 'antd';
import type { Workbook } from 'exceljs';
import { cellText, readWord, readWorkbook, setCellText, writeWord, writeWorkbook, type WordBlock } from './office-documents';


export default function OfficeEditor({ bytes, fileName, readOnly, onSave, onDirty }: {
  bytes: ArrayBuffer; fileName: string; readOnly: boolean; onSave: (file: File, exportCopy?: boolean) => Promise<void>; onDirty: (dirty: boolean) => void;
}) {
  const [workbook, setWorkbook] = useState<Workbook>();
  const [blocks, setBlocks] = useState<WordBlock[]>();
  const [html, setHtml] = useState('');
  const [editing, setEditing] = useState(false);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [page, setPage] = useState(1);
  const [rowNumber, setRowNumber] = useState(1);
  const [colNumber, setColNumber] = useState(1);
  const [query, setQuery] = useState('');
  const [modified, setModified] = useState(false);
  const [, rerender] = useState(0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const isExcel = /\.xlsx$/i.test(fileName);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (isExcel) { const result = await readWorkbook(bytes); if (!cancelled) setWorkbook(result); }
        else { const result = await readWord(bytes); if (!cancelled) { setBlocks(result.blocks); setHtml(result.html); } }
      } catch (reason) { if (!cancelled) setError(reason instanceof Error ? reason.message : '文件无法解析，请下载原件检查'); }
    })();
    return () => { cancelled = true; };
  }, [bytes, isExcel]);
  const changed = () => { setModified(true); onDirty(true); rerender(value => value + 1); };
  const exportFile = async (save: boolean) => {
    setSaving(true);
    try {
      const blob = workbook ? await writeWorkbook(workbook) : await writeWord(blocks || []);
      const name = fileName.replace(/\.(xlsx|docx)$/i, '_修改版.$1');
      await onSave(new File([blob], name, { type: blob.type }), !save); onDirty(false);
    } catch (reason) { message.error(reason instanceof Error ? reason.message : '导出失败，修改内容已保留'); }
    finally { setSaving(false); }
  };
  if (error) return <Alert type="error" title={error} description="原始文件仍可通过附件列表下载。" />;
  if (!workbook && !blocks) return <Spin description="正在解析文档" />;
  const sheet = workbook?.worksheets[sheetIndex];
  const changeBlock = (index: number, value: WordBlock) => { setBlocks(current => current?.map((block, i) => i === index ? value : block)); changed(); };
  const changeStructure = (type: 'row' | 'column', remove: boolean) => {
    if (!sheet) return;
    let hasFormula = false; sheet.eachRow(row => row.eachCell(cell => { if (cell.formula) hasFormula = true; }));
    if (hasFormula || sheet.model.merges?.length || sheet.rowCount * sheet.columnCount > 100000) { message.warning('含公式、合并单元格或大型表格，请使用 Excel/WPS 调整行列结构以保留引用关系'); return; }
    if (type === 'row') {
      if (!remove && sheet.rowCount >= 5000) return message.warning('在线编辑最多 5000 行');
      sheet.spliceRows(Math.min(rowNumber, sheet.rowCount + 1), remove ? 1 : 0, ...(!remove ? [[]] : []));
    } else {
      if (!remove && sheet.columnCount >= 100) return message.warning('在线编辑最多 100 列');
      sheet.spliceColumns(Math.min(colNumber, sheet.columnCount + 1), remove ? 1 : 0, ...(!remove ? [[]] : []));
    }
    setPage(1); changed();
  };
  const rowIds = sheet ? Array.from({ length: Math.max(sheet.rowCount, 1) }, (_, i) => i + 1).filter(row => !query || Array.from({ length: Math.max(sheet.columnCount, 1) }, (_, col) => cellText(sheet.getCell(row, col + 1).value, modified)).some(text => text.toLowerCase().includes(query.toLowerCase()))) : [];
  return <div className="approval-office">
    <Alert type="info" showIcon title={isExcel ? '支持单元格及行列的基本编辑。公式只读，修改数据后请在 Excel/WPS 中重算。原件保留。' : '预览正文与表格；基本编辑导出不保留复杂排版、图片及页眉页脚。原件保留，可随时下载。'} />
    <Space wrap style={{ margin: '12px 0' }}>
      <Input aria-label="搜索文档内容" placeholder="搜索内容" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} allowClear style={{ width: 220 }} />
      {!readOnly && !isExcel && <Button onClick={() => setEditing(value => !value)}>{editing ? '查看编辑结果' : '编辑正文与表格'}</Button>}
      {!readOnly && <Button onClick={() => void exportFile(false)} loading={saving}>保存并导出修改版</Button>}
      {!readOnly && <Button type="primary" disabled={!modified} onClick={() => void exportFile(true)} loading={saving}>保存修改版为附件</Button>}
    </Space>
    {sheet && <>
      <Space wrap style={{ marginBottom: 12 }}>
        <Select aria-label="工作表" value={sheetIndex} onChange={value => { setSheetIndex(value); setPage(1); }} options={workbook!.worksheets.map((item, i) => ({ value: i, label: item.name }))} style={{ minWidth: 150 }} />
        {!readOnly && <>
          <span>行号</span><InputNumber aria-label="操作行号" min={1} max={sheet.rowCount + 1} value={rowNumber} onChange={value => setRowNumber(value || 1)} />
          <Button onClick={() => changeStructure('row', false)}>插入行</Button><Button danger onClick={() => changeStructure('row', true)}>删除行</Button>
          <span>列号</span><InputNumber aria-label="操作列号" min={1} max={sheet.columnCount + 1} value={colNumber} onChange={value => setColNumber(value || 1)} />
          <Button onClick={() => changeStructure('column', false)}>插入列</Button><Button danger onClick={() => changeStructure('column', true)}>删除列</Button>
        </>}
      </Space>
      <div className="approval-sheet-scroll"><table><thead><tr><th>行号</th>{Array.from({ length: Math.max(sheet.columnCount, 1) }, (_, col) => <th key={col}>{sheet.getColumn(col + 1).letter}</th>)}</tr></thead>
        <tbody>{rowIds.slice((page - 1) * 25, page * 25).map(row => <tr key={row}><th>{row}</th>{Array.from({ length: Math.max(sheet.columnCount, 1) }, (_, col) => {
          const cell = sheet.getCell(row, col + 1);
          return <td key={col}>{readOnly || cell.formula || cell.isMerged ? <span>{cellText(cell.value, modified)}</span> : <Input aria-label={`${sheet.name} ${cell.address}`} value={cellText(cell.value)} onChange={event => { setCellText(sheet, row, col + 1, event.target.value); changed(); }} />}</td>;
        })}</tr>)}</tbody></table></div>
      <Pagination current={page} pageSize={25} total={rowIds.length} onChange={setPage} showSizeChanger={false} />
    </>}
    {blocks && !editing && !modified && !query && <div className="approval-word-preview" dangerouslySetInnerHTML={{ __html: html }} />}
    {blocks && (editing || modified || !!query) && <div className="approval-word-preview">{blocks.map((block, index) => {
      const text = block.kind === 'paragraph' ? block.text : block.rows.flat().join(' ');
      if (query && !text.toLowerCase().includes(query.toLowerCase())) return null;
      const editable = editing && !readOnly;
      return <div key={index} style={{ marginBottom: 12 }}>
        {block.kind === 'paragraph' ? editable ? <Input.TextArea aria-label={`段落 ${index + 1}`} autoSize value={block.text} onChange={event => changeBlock(index, { ...block, text: event.target.value })} /> : <p style={{ whiteSpace: 'pre-wrap' }}>{block.text}</p> : <>
          <table><tbody>{block.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}>{editable ? <Input.TextArea aria-label={`表格 ${index + 1} 行 ${r + 1} 列 ${c + 1}`} autoSize value={cell} onChange={event => changeBlock(index, { ...block, rows: block.rows.map((line, ri) => ri === r ? line.map((v, ci) => ci === c ? event.target.value : v) : line) })} /> : cell}</td>)}{editable && <td><Button danger size="small" onClick={() => changeBlock(index, { ...block, rows: block.rows.filter((_, ri) => ri !== r) })}>删行</Button></td>}</tr>)}</tbody></table>
          {editable && <Space wrap><Button onClick={() => changeBlock(index, { ...block, rows: [...block.rows, Array(Math.max(block.rows[0]?.length || 1, 1)).fill('')] })}>添加表格行</Button><Button onClick={() => changeBlock(index, { ...block, rows: block.rows.length ? block.rows.map(row => [...row, '']) : [['']] })}>添加表格列</Button>{(block.rows[0] || []).map((_, c) => <Button key={c} danger onClick={() => changeBlock(index, { ...block, rows: block.rows.map(row => row.filter((_, ci) => ci !== c)) })}>删除第 {c + 1} 列</Button>)}</Space>}
        </>}
        {editable && <Space><Button onClick={() => { setBlocks(current => [...current!.slice(0, index + 1), { kind: 'paragraph', text: '' }, ...current!.slice(index + 1)]); changed(); }}>下方插入段落</Button><Button danger onClick={() => { setBlocks(current => current?.filter((_, i) => i !== index)); changed(); }}>删除此内容</Button></Space>}
      </div>;
    })}</div>}
    {blocks && editing && !readOnly && <Space><Button onClick={() => { setBlocks(current => [...current!, { kind: 'paragraph', text: '' }]); changed(); }}>添加段落</Button><Button onClick={() => { setBlocks(current => [...current!, { kind: 'table', rows: [['', ''], ['', '']] }]); changed(); }}>添加表格</Button></Space>}
  </div>;
}
