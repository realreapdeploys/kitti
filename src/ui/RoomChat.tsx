import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ChatMsg } from '../chat/chat'

interface RoomChatProps {
  messages: ChatMsg[]
  onSend: (text: string) => void
  disabled?: boolean
  title?: string
  compact?: boolean
}

/** One chat line feed used by rooms (lobby + in-game). Plain text only; React escapes. */
export function RoomChat({ messages, onSend, disabled, title, compact }: RoomChatProps) {
  const [draft, setDraft] = useState('')
  const feedRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = feedRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const t = draft.trim()
    if (!t || disabled) return
    onSend(t)
    setDraft('')
  }

  return (
    <section className={`room-chat${compact ? ' room-chat-compact' : ''}`} aria-label={title ?? 'Table chat'}>
      <div className="chat-head">
        <span className="chat-title">{title ?? 'Table chat'}</span>
        <span className="chat-count">{messages.length} message{messages.length === 1 ? '' : 's'}</span>
      </div>
      <div className="chat-feed" role="log" aria-live="polite" ref={feedRef}>
        {messages.length === 0 && <p className="chat-empty">No messages yet — say hello.</p>}
        {messages.map(m => (
          m.kind === 'system'
            ? <p key={m.id} className="chat-line chat-system">{m.text}</p>
            : <p key={m.id} className={`chat-line${m.pending ? ' chat-pending' : ''}`} title={m.pending ? 'Sending…' : undefined}><span className="chat-from">{m.from}</span><span className="chat-text">{m.text}</span></p>
        ))}
      </div>
      <form className="chat-input-row" onSubmit={submit}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Message the table…"
          maxLength={280}
          aria-label="Chat message"
          disabled={disabled}
          autoComplete="off"
        />
        <button className="btn btn-gold chat-send" type="submit" disabled={disabled || !draft.trim()}>Send</button>
      </form>
    </section>
  )
}
