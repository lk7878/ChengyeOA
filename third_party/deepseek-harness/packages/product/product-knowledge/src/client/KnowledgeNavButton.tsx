import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './KnowledgeBaseCenter.module.css'

type Props = PropsRuntime<'sidebar.footer.action'> & PropsLocale<'product.knowledge'> & { open: () => void }

export function KnowledgeNavButton({ wide, open, t }: Props) {
  return <button type="button" className={css.navButton} onClick={open} aria-label={t('nav')} title={t('nav')}>
    <span aria-hidden="true">⌘</span>{wide && <span>{t('nav')}</span>}
  </button>
}
