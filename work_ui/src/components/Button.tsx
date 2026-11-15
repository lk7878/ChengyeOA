import type { ButtonHTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'
import './Button.css'

export type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'toolbar' | 'danger'
export type ButtonSize = 'md' | 'sm'

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
  block?: boolean
}

export function Button({
  variant = 'ghost',
  size = 'md',
  icon,
  block,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={clsx('wb-btn', `wb-btn--${variant}`, `wb-btn--${size}`, block && 'wb-btn--block', className)}
      {...rest}
    >
      {icon != null && <span className="wb-btn__icon">{icon}</span>}
      {children}
    </button>
  )
}
