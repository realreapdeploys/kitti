import { LogEntry } from '../engine/game'
import { formatChips } from './money'

/** Engine log strings contain pot amounts in raw cents; render them as dollars. */
const display = (text: string): string =>
  text.replace(/(Pot of |takes the pot of )(\d+)/g, (_m, prefix: string, n: string) => `${prefix}${formatChips(Number(n))}`)

const iconFor = (text: string): string => {
  const t = text.toLowerCase()
  if (t.includes('salami')) return '✦'
  if (t.includes('kitti')) return '✺'
  if (t.includes('lock')) return '✓'
  if (t.includes('win') || t.includes('takes the pot')) return '★'
  if (t.includes('deal')) return '❖'
  return '•'
}

export function GameLog({ entries }: { entries: LogEntry[] }) {
  return (
    <aside className="gamelog" aria-label="Game log">
      <h3>Game Log</h3>
      <div role="log" aria-live="polite">
        {entries.slice(-60).map(e => (
          <div key={e.id} className="log-line"><span className="log-icon" aria-hidden="true">{iconFor(e.text)}</span><span>{display(e.text)}</span></div>
        ))}
      </div>
    </aside>
  )
}
