import { useState, type ChangeEvent, type FormEvent } from 'react'
import { Avatar, PERSONALITY_META } from './Avatar'
import { DEFAULT_CONFIG } from '../engine/config'
import { playSound } from './sound'

export interface SetupValues {
  botCount: 1 | 2 | 3 | 4
  startingChips: number
  boot: number
  winCondition: 'any_two' | 'consecutive_two'
  salamiBonusMultiplier: number
  enforceOrder: boolean
  aceTwoThreeRank: 'second_highest' | 'lowest'
  allowTwoThreeFive: boolean
  fourOfAKindAutoWin: boolean
  fourPairsRedeal: boolean
  seed: string
}
interface Props { onStart: (values: SetupValues) => void }

const PERSONA_CYCLE = ['safe', 'aggressive', 'balanced', 'unpredictable']

export function SetupScreen({ onStart }: Props) {
  const [values, setValues] = useState<SetupValues>({
    botCount: 2,
    startingChips: 20,   // dollars; converted to integer cents at game start
    boot: 1,
    // engine defaults below otherwise unchanged
    winCondition: DEFAULT_CONFIG.winCondition,
    salamiBonusMultiplier: DEFAULT_CONFIG.salamiBonusMultiplier,
    enforceOrder: DEFAULT_CONFIG.enforceOrder,
    aceTwoThreeRank: DEFAULT_CONFIG.aceTwoThreeRank,
    allowTwoThreeFive: DEFAULT_CONFIG.allowTwoThreeFive,
    fourOfAKindAutoWin: DEFAULT_CONFIG.fourOfAKindAutoWin,
    fourPairsRedeal: DEFAULT_CONFIG.fourPairsRedeal,
    seed: ''
  })
  const set = <K extends keyof SetupValues>(k: K, v: SetupValues[K]) => setValues(s => ({ ...s, [k]: v }))
  const onNumber = (k: 'salamiBonusMultiplier') => (e: ChangeEvent<HTMLInputElement>) =>
    set(k, Math.max(0, Number(e.target.value) || 0))
  const onMoney = (k: 'startingChips' | 'boot') => (e: ChangeEvent<HTMLInputElement>) =>
    set(k, Math.max(0, Number(e.target.value) || 0))

  return (
    <div className="setup-wrap">
      <form className="setup-card" aria-label="New game setup" onSubmit={(e: FormEvent) => { e.preventDefault(); playSound('button'); onStart(values) }}>
        <h1 className="wordmark">KITTI</h1>
        <p className="tagline"><strong>Nau Patti</strong> · Nine Card Brag</p>

        <div style={{ marginBottom: 'var(--s3)' }}>
          <div className="field full" style={{ alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span>Bots at the table</span>
            <div className="bot-seg" role="group" aria-label="Number of bots">
              {[1, 2, 3, 4].map(n => {
                const persona = PERSONA_CYCLE[(n - 1) % PERSONA_CYCLE.length]!
                return (
                  <button
                    key={n}
                    type="button"
                    className="bot-choice"
                    aria-pressed={values.botCount === n}
                    aria-label={`${n} bot${n > 1 ? 's' : ''}`}
                    onClick={() => set('botCount', n as 1 | 2 | 3 | 4)}
                  >
                    <Avatar personality={persona} size={40} />
                    <span className="n">{n}</span>
                    <span style={{ fontSize: '.55rem', letterSpacing: '.12em', textTransform: 'uppercase', opacity: .75 }}>{PERSONALITY_META[persona]?.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div className="form-grid">
          <label className="field">Starting chips ($)
            <input type="number" min="1" step="0.5" value={values.startingChips} onChange={onMoney('startingChips')} />
          </label>
          <label className="field">Boot per hand ($)
            <input type="number" min="0.5" step="0.5" value={values.boot} onChange={onMoney('boot')} />
          </label>
          <div className="field full">
            <span>Win condition</span>
            <div className="win-seg" role="group" aria-label="Win condition">
              <button type="button" aria-pressed={values.winCondition === 'any_two'} onClick={() => set('winCondition', 'any_two')}>Win any 2 of 3</button>
              <button type="button" aria-pressed={values.winCondition === 'consecutive_two'} onClick={() => set('winCondition', 'consecutive_two')}>Win 2 consecutive</button>
            </div>
          </div>
          <label className="field">Salami bonus (× boot)
            <input type="number" min="0" step="1" value={values.salamiBonusMultiplier} onChange={onNumber('salamiBonusMultiplier')} />
          </label>
          <label className="field">A-2-3 run order
            <select value={values.aceTwoThreeRank} onChange={e => set('aceTwoThreeRank', e.target.value as 'second_highest' | 'lowest')}>
              <option value="second_highest">Second highest (after A-K-Q)</option>
              <option value="lowest">Lowest run</option>
            </select>
          </label>
          <label className="field toggle"><input type="checkbox" checked={values.enforceOrder} onChange={e => set('enforceOrder', e.target.checked)} /> Enforce hand order (Hand 1 ≥ Hand 2 ≥ Hand 3)</label>
          <label className="field toggle"><input type="checkbox" checked={values.allowTwoThreeFive} onChange={e => set('allowTwoThreeFive', e.target.checked)} /> House rule: 2-3-5 beats all</label>
          <label className="field toggle"><input type="checkbox" checked={values.fourOfAKindAutoWin} onChange={e => set('fourOfAKindAutoWin', e.target.checked)} /> House rule: four of a kind auto-wins</label>
          <label className="field toggle"><input type="checkbox" checked={values.fourPairsRedeal} onChange={e => set('fourPairsRedeal', e.target.checked)} /> House rule: four pairs forces a redeal (kitti)</label>
          <label className="field full">Seed (optional — same seed replays the same game)
            <input type="text" inputMode="numeric" placeholder="e.g. 12345" aria-label="Seed" value={values.seed} onChange={e => set('seed', e.target.value)} />
          </label>
        </div>

        <div className="setup-foot">
          <span className="seed-hint">Leave the seed blank for a random table.</span>
          <button type="submit" className="btn btn-gold btn-cta">Deal me in</button>
        </div>
      </form>
    </div>
  )
}
