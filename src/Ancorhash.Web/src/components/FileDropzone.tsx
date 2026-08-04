import { useCallback, useRef, useState } from 'react'
import type { DragEvent } from 'react'

interface FileDropzoneProps {
  onFileSelected: (file: File) => void
  disabled?: boolean
}

/** Area drag & drop minimale con fallback su input file nativo. */
export function FileDropzone({ onFileSelected, disabled }: FileDropzoneProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setIsDragOver(false)
      if (disabled) return
      const file = event.dataTransfer.files[0]
      if (file) onFileSelected(file)
    },
    [disabled, onFileSelected],
  )

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Carica un documento"
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
          e.preventDefault()
          inputRef.current?.click()
        }
      }}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setIsDragOver(true)
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-14 text-center transition-colors ${
        isDragOver
          ? 'border-neutral-900'
          : 'border-neutral-300 hover:border-neutral-400'
      } ${disabled ? 'pointer-events-none opacity-50' : ''}`}
    >
      <svg
        className="h-6 w-6 text-neutral-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 16.5V9.75m0 0-3 3m3-3 3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z" />
      </svg>
      <p className="text-sm font-medium text-neutral-700">
        Trascina qui il documento
      </p>
      <p className="text-xs text-neutral-400">
        oppure clicca per selezionarlo
      </p>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFileSelected(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}
