// Tiny app-wide toast bus so non-React code (e.g. Zustand store actions) can surface a transient
// status message. ToastHost subscribes and renders it into an aria-live region for screen readers.
// A toast may carry one action (e.g. "Undo") so a destructive mutation can offer an immediate revert.

export interface ToastAction {
  label: string
  onAction: () => void
}

/** 'pr' renders a celebratory trophy variant (used for a new est-1RM record); 'default' is the
 *  neutral check-mark status pill. */
export type ToastTone = 'default' | 'pr'

export interface ToastData {
  message: string
  action?: ToastAction
  tone?: ToastTone
}

type ToastListener = (toast: ToastData) => void

let listeners: ToastListener[] = []

/** Fire a transient status message, optionally with a single action (e.g. Undo) and a tone. No-op if
 *  nothing is listening (e.g. during SSR). */
export function emitToast(message: string, action?: ToastAction, tone: ToastTone = 'default'): void {
  const toast: ToastData = { message, action, tone }
  for (const l of listeners) l(toast)
}

/** Subscribe to toast messages; returns an unsubscribe function. */
export function subscribeToast(listener: ToastListener): () => void {
  listeners.push(listener)
  return () => {
    listeners = listeners.filter((l) => l !== listener)
  }
}
