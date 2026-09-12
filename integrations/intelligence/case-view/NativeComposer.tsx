import React, { useEffect, useMemo, useRef } from 'react';
import { createEditor, $getRoot, $createParagraphNode, $createTextNode, $getSelection, $isRangeSelection } from 'lexical';
import { registerPlainText } from '@lexical/plain-text';
import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import { InputBar } from '../../../third_party/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/InputBar';
import { t } from './locale';

/** Adapt local draft/submit state to the unmodified native Lexical composer. */
export function NativeComposer({ model, owner, onTools }: { model: any; owner: any; onTools: () => void }) {
  const latest = useRef(model); latest.current = model;
  const editor = useMemo(() => createEditor({ namespace: 'chengye-case-composer', onError: error => { throw error; } }), []);
  useEffect(() => {
    const plain = registerPlainText(editor);
    const history = registerHistory(editor, createEmptyHistoryState(), 1000);
    const update = editor.registerUpdateListener(({ editorState }) => {
      const value = editorState.read(() => $getRoot().getTextContent());
      if (value !== latest.current.text) latest.current.setText(value);
    });
    return () => { update(); history(); plain(); };
  }, [editor]);
  useEffect(() => {
    if (editor.getEditorState().read(() => $getRoot().getTextContent()) === model.text) return;
    editor.update(() => { $getRoot().clear().append($createParagraphNode().append($createTextNode(model.text))); }, { discrete: true });
  }, [model.text, editor]);
  const keyboard = useMemo(() => ({ editor, arbitrate: () => 'pass', space: () => false, dismissPopup() {},
    submit: () => { if (!latest.current.busy && latest.current.text.trim()) void latest.current.send(); },
    steerQueue() {}, caretSpan: () => null,
    paste: (text: string) => editor.update(() => { const selection = $getSelection(); if ($isRangeSelection(selection)) selection.insertRawText(text); }),
  }), [editor]);
  const input = { draft: model.text, phase: model.busy ? 'submitting' : 'editing', imageIds: [], queue: [] };
  const session = { running: model.statuses[model.selected] === 'running', removed: false, subagent: null, promptError: null };
  return <InputBar {...owner} {...({
    sessionId: model.selected || undefined, t,
    useSession: (select: any) => select(session), useInput: (select: any) => select(input),
    inputActions: { submit: () => keyboard.submit(), pruneImages() {} }, keyboard,
    useNotices: (select: any) => select(null), useLexicon: (select: any) => select([]),
    useMenuLauncher: (select: any) => select(null), useProjection: (_: unknown, select?: any) => select ? select(undefined) : undefined,
    resolveSubmitMode: () => 'queue', toggleCommandMenu: onTools, stop: model.stop,
    renderSlot: () => null,
  } as any)} placeholder={model.workspace ? '描述你的办案需求…' : '正在打开本机工作区…'} />;
}
