import { describe, it, expect } from 'vitest'
import { sanitizeChatText, normalizeName, isNameTaken, ChatLog, suggestFreeName, CHAT_MAX } from '../src/chat/chat'

describe('sanitizeChatText', () => {
  it('strips control chars and collapses whitespace', () => {
    expect(sanitizeChatText('  hello\u0000 \t world\n\nagain  ')).toBe('hello world again')
  })
  it('truncates to CHAT_MAX', () => {
    expect(sanitizeChatText('x'.repeat(1000))).toHaveLength(CHAT_MAX)
  })
  it('empty in, empty out', () => {
    expect(sanitizeChatText('   ')).toBe('')
  })
})

describe('normalizeName', () => {
  it('is case-, space- and diacritic-insensitive', () => {
    expect(normalizeName('  Holly  ')).toBe('holly')
    expect(normalizeName('H O   L  L Y')).toBe('h o l l y')
    expect(normalizeName('Súffolke')).toBe(normalizeName('Suffolké'))
  })
})

describe('isNameTaken', () => {
  it('detects collisions ignoring case/spacing', () => {
    expect(isNameTaken('holly', ['Holly '])).toBe(true)
    expect(isNameTaken('Holly', ['Gary'])).toBe(false)
  })
})

describe('suggestFreeName', () => {
  it('suggests the base when free', () => {
    expect(suggestFreeName('Holly', ['Gary'])).toBe('Holly')
  })
  it('suffixes the smallest free number', () => {
    expect(suggestFreeName('Holly', ['Holly', 'Holly2'])).toBe('Holly3')
  })
})

describe('ChatLog', () => {
  it('is bounded and keeps the newest messages', () => {
    const log = new ChatLog(3)
    for (let i = 1; i <= 5; i++) log.push({ id: String(i), from: 'X', seat: 0, text: `m${i}`, kind: 'user', at: i })
    const all = log.all()
    expect(all).toHaveLength(3)
    expect(all.map(m => m.text)).toEqual(['m3', 'm4', 'm5'])
  })
  it('system messages are tagged and sanitized', () => {
    const log = new ChatLog()
    log.pushSystem('Table', '  GuestGary was kicked\u0007 by the host  ')
    const [m] = log.all()
    expect(m!.kind).toBe('system')
    expect(m!.seat).toBe(-1)
    expect(m!.text).toBe('GuestGary was kicked by the host')
  })
})
