import type { ReactNode } from 'react'
import clsx from 'clsx'
import './Tag.css'

export type TagTone =
  | 'neutral'
  | 'business'
  | 'success'
  | 'warn'
  | 'error'
  | 'info'

export interface TagProps {
  tone?: TagTone
  children: ReactNode
  className?: string
  dot?: boolean
}

export function Tag({ tone = 'neutral', children, className, dot }: TagProps) {
  return (
    <span className={clsx('wb-tag', `wb-tag--${tone}`, className)}>
      {dot && <span className="wb-tag__dot" />}
      {children}
    </span>
  )
}
