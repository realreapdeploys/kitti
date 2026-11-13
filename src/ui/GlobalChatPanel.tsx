import { useEffect, useRef, useState, type FormEvent } from 'react'
import { GlobalChatClient } from '../chat/globalChat'
import { sanitizeChatText, type ChatMsg } from '../chat/chat'

/**
 * The public lobby's global chat. Public, anonymous, plaintext — everything you
 * post is visible to anyone in the kitti lobby. The room chat covers the same
 * people while playing; this is for the lobby at large.
 */
export function GlobalChatPanel() {
  const saved = () => { try { return localStorage.getItem('kitti-name') ?? '' } catch { return '' } }
  const [nameDraft, setNameDraft] = useState(saved)
  const [claimed, setClaimed] = useState<string | null>(null)
  const [client, setClient] = useState<GlobalChatClient | null>(null)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [others, setOthers] = useState<string[]>([])
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const feedRef = useRef<HTMLDivElement>(null)

  // teardown on unmount
  useEffect(() => () => { void client?.disconnect() }, [client])

  useEffect(() => {
    const el = feedRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length])

  const join = async (useName?: string) => {
    const nm = sanitizeChatText(useName ?? nameDraft).slice(0, 24)
    if (!nm) { setError('Pick a name first.'); return }
    setConnecting(true); setError(null)
    try { await client?.disconnect() } catch { /* noop */ }
    const c = await GlobalChatClient.connect(nm).catch(() => null)
    if (!c) { setError('Could not reach the global lobby — check your connection and try again.'); setConnecting(false); return }
    c.onMessage = msgs => setMessages(msgs)
    c.onPresence = names => setOthers(names)
    // seed the presence list synchronously for immediate feedback
    setClient(c); setClaimed(c.name); setOthers(c.others); setConnecting(false)
    try { localStorage.setItem('kitti-name', c.name) } catch { /* ignore */ }
  }

  const nameTaken = client?.nameTaken ?? false
  const suggested = client && nameTaken ? client.suggestedName() : null
  const send = (e: FormEvent) => {
    e.preventDefault()
    const t = sanitizeChatText(draft)
    if (!client || !t || nameTaken) return
    void client.send(t).then(ok => { if (ok) setDraft('') })
  }

  return (
    <section className="global-chat" aria-label="Global lobby chat">
      <div className="chat-head">
        <span className="chat-title">Global lobby</span>
        {client && <span className="chat-count">{others.length + 1} live</span>}
      </div>

      {!client && (
        <form className="chat-input-row" onSubmit={e => { e.preventDefault(); void join() }}>
          <input value={nameDraft} onChange={e => setNameDraft(e.target.value)} placeholder="Your name" maxLength={24} aria-label="Name for the global chat" autoComplete="off" />
          <button className="btn" type="submit" disabled={connecting || !nameDraft.trim()}>{connecting ? 'Joining…' : 'Join chat'}</button>
        </form>
      )}

      {client && (
        <>
          <p className="room-note global-chat-meta">Chatting as <strong>{claimed}</strong> · {others.length} other{others.length === 1 ? '' : 's'} live · names here are held live — one person per name</p>
          {nameTaken && suggested && (
            <p role="alert" className="tab-error">That name is claimed by someone live right now.{' '}
              <button className="btn btn-inline" onClick={() => void client.switchName(suggested).then(ok => { if (ok) setClaimed(suggested) })}>Switch to {suggested}</button>
            </p>
          )}
          <div className="chat-feed chat-feed-global" role="log" aria-live="polite" ref={feedRef}>
            {messages.length === 0 && <p className="chat-empty">Quiet in here — be the first to say hello.</p>}
            {messages.map(m => (
              m.kind === 'system'
                ? <p key={m.id} className="chat-line chat-system">{m.text}</p>
                : <p key={m.id} className="chat-line"><span className="chat-from">{m.from}</span><span className="chat-text">{m.text}</span></p>
            ))}
          </div>
          <form className="chat-input-row" onSubmit={send}>
            <input value={draft} onChange={e => setDraft(e.target.value)} placeholder={nameTaken ? 'Name taken — switch to send' : `Message everyone as ${claimed}…`} maxLength={280} aria-label="Global chat message" disabled={nameTaken} autoComplete="off" />
            <button className="btn btn-gold chat-send" type="submit" disabled={nameTaken || !draft.trim()}>Send</button>
          </form>
        </>
      )}
      {error && <p role="alert" className="tab-error">{error}</p>}
      <p className="room-note global-chat-hint">Names here and in rooms are unique while you’re playing.</p>
    </section>
  )
}
