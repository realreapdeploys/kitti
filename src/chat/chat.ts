/* Shared chat primitives: names, text hygiene, bounded log. Pure and tested. */

/** One chat message. kind 'system' is written by the host for table events. */
export interface ChatMsg {
  id: string
  from: string
  /** -1 for system messages. */
  seat: number
  text: string
  kind: 'user' | 'system'
  /** ms epoch */
  at: number
  /** optimistic line waiting for the server id — rendered dimmed */
  pending?: boolean
}

export const CHAT_MAX = 280
export const CHAT_LOG_MAX = 60

/** Invisible/format controls and collapse of whitespace — chat is plain text, one line. */
export function sanitizeChatText(raw: string): string {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  return raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX)
}

/** Canonical key for comparing names: case-, space- and diacritic-insensitive. */
export function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
}

export function isNameTaken(wanted: string, takenNames: string[]): boolean {
  const key = normalizeName(wanted)
  if (!key) return false
  return takenNames.some(n => normalizeName(n) === key)
}

export function newChatId(): string {
  return Math.random().toString(36).slice(2, 8) + '-' + Date.now().toString(36)
}

/** Bounded ring of messages; oldest are dropped past `max`. */
export class ChatLog {
  private msgs: ChatMsg[] = []
  constructor(private readonly max = CHAT_LOG_MAX) {}
  push(m: ChatMsg): ChatMsg[] {
    this.msgs.push(m)
    if (this.msgs.length > this.max) this.msgs = this.msgs.slice(this.msgs.length - this.max)
    return this.all()
  }
  pushSystem(from: string, text: string, at = Date.now()): ChatMsg[] {
    return this.push({ id: newChatId(), from, seat: -1, text: sanitizeChatText(text), kind: 'system', at })
  }
  all(): ChatMsg[] {
    return [...this.msgs]
  }
  /** Replace with an authoritative snapshot list (used by guests on every state update). */
  replaceWith(msgs: ChatMsg[]): ChatMsg[] {
    this.msgs = msgs.slice(-this.max)
    return this.all()
  }
}

/** Find the smallest N such that `NameN` is free (for friendly suggestions). */
export function suggestFreeName(base: string, takenNames: string[]): string {
  const trimmed = base.trim().slice(0, 24) || 'Player'
  if (!isNameTaken(trimmed, takenNames)) return trimmed
  for (let n = 2; n <= 99; n++) {
    const candidate = `${trimmed}${n}`
    if (!isNameTaken(candidate, takenNames)) return candidate
  }
  return `${trimmed}${Date.now() % 1000}`
}
