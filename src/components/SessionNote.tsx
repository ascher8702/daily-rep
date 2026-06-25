'use client'

import { useState } from 'react'

/**
 * Inline editable session note. Holds a local draft for smooth typing and commits on blur — but
 * only when the trimmed text actually changed, so mounting or tabbing away never writes a no-op.
 * Mount with a `key` tied to the workout id so switching workouts resets the draft.
 */
export default function SessionNote({
  value,
  onSave,
  placeholder,
}: {
  value: string
  onSave: (v: string) => void
  placeholder: string
}) {
  const [text, setText] = useState(value)
  return (
    <textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text.trim() !== value.trim()) onSave(text)
      }}
      placeholder={placeholder}
      maxLength={500}
      rows={2}
      aria-label="Session note"
      className="w-full resize-none rounded-xl bg-raised border border-hairline/[0.08] px-3 py-2.5 text-sm leading-snug outline-none focus:border-blaze placeholder:text-fg/30"
    />
  )
}
