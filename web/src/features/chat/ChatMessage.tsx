import { Fragment } from 'react'
import type { ChatMessage as Message } from '../../api/types'
import { OutlinePill } from '../../components/ui/Bits'

export function ChatMessage({
  message,
  onSaveNote,
  onMakeCards,
  onQuiz,
}: {
  message: Message
  onSaveNote?: () => void
  onMakeCards?: () => void
  onQuiz?: () => void
}) {
  if (message.role === 'user') {
    return (
      <div className="max-w-[70%] self-end rounded-[16px_16px_4px_16px] bg-brand px-3.5 py-3 text-[13.5px] text-white whitespace-pre-wrap">
        {message.content}
      </div>
    )
  }

  const citations = message.citations ?? []

  return (
    <div className="flex max-w-[88%] flex-col gap-2.5 rounded-[16px_16px_16px_4px] border-[1.5px] border-line bg-surface p-3.5 text-[13.5px] leading-[1.55]">
      {citations.length > 0 && (
        <div className="flex items-center gap-2 text-[11.5px] font-semibold text-muted">
          <span className="flex h-4.5 w-4.5 items-center justify-center rounded-md bg-brand-soft text-[10px]">
            ✦
          </span>
          Answered from {citations.length} source{citations.length === 1 ? '' : 's'}
        </div>
      )}

      <p className="whitespace-pre-wrap">
        <CitedText content={message.content} />
      </p>

      {citations.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {citations.map((c) => (
            <div
              key={c.marker}
              className="min-w-40 flex-1 rounded-xl border-[1.5px] border-line px-2.5 py-2 text-[11.5px]"
            >
              <div className="flex gap-1.5 font-bold">
                <span className="text-brand">{c.marker}</span>
                <span className="truncate">{c.document_name}</span>
              </div>
              <div className="text-muted">
                {c.locator} · {c.snippet}
              </div>
            </div>
          ))}
        </div>
      )}

      {(onSaveNote || onMakeCards || onQuiz) && (
        <div className="flex gap-2 pt-0.5">
          {onSaveNote && <OutlinePill onClick={onSaveNote}>📝 Save as note</OutlinePill>}
          {onMakeCards && <OutlinePill onClick={onMakeCards}>🗂 Make cards</OutlinePill>}
          {onQuiz && <OutlinePill onClick={onQuiz}>❓ Quiz me</OutlinePill>}
        </div>
      )}
    </div>
  )
}

/** Split `text[[n]]more` into prose + inline citation markers. */
function CitedText({ content }: { content: string }) {
  const parts = content.split(/\[\[(\d+)\]\]/g)
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span
            key={i}
            className="ml-1 rounded-md bg-brand-soft px-1.5 py-px text-[11px] font-bold text-brand-deep"
          >
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}
