import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { Button } from './Button'
import './Modal.css'

export interface ModalProps {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children?: ReactNode
  footer?: ReactNode
  width?: number | string
}

export function Modal({ open, title, description, onClose, children, footer, width = 560 }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="wb-modal__overlay" onClick={onClose}>
      <div
        className="wb-modal"
        style={{ width }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header className="wb-modal__header">
          <div>
            <h2 className="wb-modal__title">{title}</h2>
            {description && <p className="wb-modal__desc">{description}</p>}
          </div>
          <button className="wb-modal__close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        <div className="wb-modal__body">{children}</div>
        {footer && <footer className="wb-modal__footer">{footer}</footer>}
      </div>
    </div>
  )
}

export function ModalActions({ onCancel, onConfirm, confirmText = '确定', cancelText = '取消', confirmVariant = 'primary' }: {
  onCancel: () => void
  onConfirm: () => void
  confirmText?: string
  cancelText?: string
  confirmVariant?: 'primary' | 'danger'
}) {
  return (
    <div className="wb-modal__actions">
      <Button variant="outline" onClick={onCancel}>
        {cancelText}
      </Button>
      <Button variant={confirmVariant} onClick={onConfirm}>
        {confirmText}
      </Button>
    </div>
  )
}
