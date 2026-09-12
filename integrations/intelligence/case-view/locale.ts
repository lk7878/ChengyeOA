import { zh as conversation } from '../../../third_party/deepseek-harness/packages/client/ui-conversation/src/client/locales';
import { zh as sidebar } from '../../../third_party/deepseek-harness/packages/client/ui-sidebar/src/client/locales';
import { zh as chat } from '../../../third_party/deepseek-harness/packages/client/ui-chat/src/client/locale';
import { zh as common } from '../../../third_party/deepseek-harness/packages/client/locale/src/locales/zh';

const dictionary: Record<string, string> = {
  ...common, ...conversation, ...sidebar, ...chat,
  'brand.localBuild': '智慧办案', 'hero.headline': '今天有什么可以帮你？', 'hero.preview': '法律助手',
  'hero.chooseWorkspace': '本机办案工作区', 'placeholder.hero': '描述你的办案需求…',
  'placeholder.default': '描述你的办案需求…', 'input.commands': '办案工具',
};
/** Original Simplified Chinese dictionaries, with OA-specific product labels. */
export const t = (key: string, values?: Record<string, unknown>) =>
  (dictionary[key] ?? key).replace(/\{([^}]+)\}/g, (_, name) => String(values?.[name] ?? `{${name}}`));
