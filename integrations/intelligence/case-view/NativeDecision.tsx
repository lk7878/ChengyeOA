import React, { useState } from 'react';
import { ApprovalPanel } from '../../../third_party/deepseek-harness/packages/client/ui-approval/src/client/ApprovalPanel';
import { QuestionComposer } from '../../../third_party/deepseek-harness/packages/client/ui-user-questions/src/client/QuestionComposer';
import { zh as approval } from '../../../third_party/deepseek-harness/packages/client/ui-approval/src/client/locales';
import { zh as questions } from '../../../third_party/deepseek-harness/packages/client/ui-user-questions/src/client/locales';
import { zh as common } from '../../../third_party/deepseek-harness/packages/client/locale/src/locales/zh';

/** Keep the native approval/question takeover and wire its answers to the OA channel. */
export function NativeDecision({ event, model }: { event: any; model: any }) {
  const [state, setState] = useState<any>({ progress: { index: 0, drafts: [] } });
  const dictionary: Record<string, string> = { ...common, ...(event.type === 'approval' ? approval : questions) };
  const t = (key: string, values?: Record<string, unknown>) => (dictionary[key] ?? key).replace(/\{([^}]+)\}/g, (_, name) => String(values?.[name] ?? name));
  const matched = { ...event.request, key: event.id, answer: (value: unknown) => model.answer(event, value), cancel: () => model.answer(event, undefined, true) };
  return event.type === 'approval'
    ? <ApprovalPanel {...({ matched, t, renderSlot: () => null } as any)} />
    : <QuestionComposer {...({ matched, t, useStore: (select: any) => select(state), actions: {
      replace: (requestKey: string, progress: unknown) => setState({ requestKey, progress }),
      clear: () => setState({ progress: { index: 0, drafts: [] } }),
    } } as any)} />;
}
