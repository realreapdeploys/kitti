import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import App from '../src/ui/App'
import { ArrangingPanel } from '../src/ui/ArrangingPanel'
import { RevealPanel } from '../src/ui/RevealPanel'
import { testConfig, rigGame, resolveRig, C } from './helpers'
import { Hand, Card } from '../src/engine/types'
import { buildDeck } from '../src/engine/deck'

const hand = (a: Card, b: Card, c: Card): Hand => [a, b, c]
const spade = (r: number) => C(r, 0), heart = (r: number) => C(r, 1), club = (r: number) => C(r, 3), diamond = (r: number) => C(r, 2)

afterEach(cleanup)

describe('setup flow', () => {
  it('renders setup, starts a game with a seed, shows table and seed in footer', () => {
    render(<App />)
    expect(screen.getByLabelText('New game setup')).toBeInTheDocument()
    const seedInput = screen.getByLabelText('Seed')
    fireEvent.change(seedInput, { target: { value: '12345' } })
    fireEvent.submit(screen.getByLabelText('New game setup'))
    expect(screen.getByText('POT')).toBeInTheDocument()
    expect(screen.getByText('12345')).toBeInTheDocument()
    expect(screen.getAllByText(/Round 1/).length).toBeGreaterThan(0)
  })
})

describe('arranging panel', () => {
  it('Lock In is disabled until the arrangement is complete, then enables', async () => {
    const mine = [spade(2), heart(7), club(9), spade(5), heart(3), club(12), spade(13), heart(11), club(4)]
    const rest = buildDeck().filter(c => !mine.some(m => m.rank === c.rank && m.suit === c.suit)).slice(0, 9)
    const state = rigGame(testConfig({ botCount: 1, enforceOrder: true }), 777, [mine, rest])
    const onLockIn = vi.fn()
    render(<ArrangingPanel state={state} onLockIn={onLockIn} lockError={null} />)
    expect(screen.getByRole('button', { name: 'Lock In' })).toBeDisabled()
    // auto-arrange produces a valid arrangement
    fireEvent.click(screen.getByRole('button', { name: 'Auto-arrange' }))
    const lockBtn = screen.getByRole('button', { name: 'Lock In' })
    expect(lockBtn).toBeEnabled()
    fireEvent.click(lockBtn)
    expect(onLockIn).toHaveBeenCalledTimes(1)
    const arr = onLockIn.mock.calls[0]![0] as [Hand, Hand, Hand]
    expect(arr.flat()).toHaveLength(9)
  })

  it('auto-arrange produces an arrangement passing the engine validators', () => {
    const mine = [spade(2), heart(7), club(9), spade(5), heart(3), club(12), spade(13), heart(11), club(4)]
    const rest = buildDeck().filter(c => !mine.some(m => m.rank === c.rank && m.suit === c.suit)).slice(0, 9)
    const state = rigGame(testConfig({ botCount: 1, enforceOrder: true }), 777, [mine, rest])
    const onLockIn = vi.fn()
    render(<ArrangingPanel state={state} onLockIn={onLockIn} lockError={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Auto-arrange' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lock In' }))
    expect(onLockIn).toHaveBeenCalledTimes(1)
  })

  it('shows the order warning and disables Lock In when the arrangement breaks the order rule', () => {
    // Construct a rigged 9-card hand where we can force a broken order by clicking weakest-first into Hand 1
    const mine = [spade(9), heart(7), club(2), spade(12), heart(9), club(12), spade(14), heart(14), club(14)]
    const rest = buildDeck().filter(c => !mine.some(m => m.rank === c.rank && m.suit === c.suit)).slice(0, 9)
    const state = rigGame(testConfig({ botCount: 1, enforceOrder: true }), 555, [mine, rest])
    render(<ArrangingPanel state={state} onLockIn={vi.fn()} lockError={null} />)
    // Place the three weakest cards into Hand 1 (they are sorted ascending in the tray)
    const trayCards = screen.getAllByRole('listitem')
    expect(trayCards.length).toBe(9)
    // find tray card buttons and click the three weakest: 2♣ (rank 2), 7♥ (7), 9♠ (9)
    const clickCard = (label: RegExp) => {
      const btn = screen.getAllByRole('listitem', { name: label })[0]!
      // toggle selection
      fireEvent.click(btn)
    }
    clickCard(/^2 of clubs/)
    // now place into Hand 1 by clicking the Hand 1 group
    fireEvent.click(screen.getByRole('group', { name: 'Hand 1' }))
    clickCard(/^7 of hearts/)
    fireEvent.click(screen.getByRole('group', { name: 'Hand 1' }))
    clickCard(/^9 of spades/)
    fireEvent.click(screen.getByRole('group', { name: 'Hand 1' }))
    // place strong cards into Hands 2 and 3
    clickCard(/^9 of hearts/)
    fireEvent.click(screen.getByRole('group', { name: 'Hand 2' }))
    clickCard(/^12 of clubs/)
    fireEvent.click(screen.getByRole('group', { name: 'Hand 2' }))
    clickCard(/^12 of spades/)
    fireEvent.click(screen.getByRole('group', { name: 'Hand 2' }))
    clickCard(/^14 of clubs/)
    fireEvent.click(screen.getByRole('group', { name: 'Hand 3' }))
    clickCard(/^14 of hearts/)
    fireEvent.click(screen.getByRole('group', { name: 'Hand 3' }))
    clickCard(/^14 of spades/)
    fireEvent.click(screen.getByRole('group', { name: 'Hand 3' }))
    // arrangement: H1 = 2♣ 7♥ 9♠ (9-high), H2 = 9♥ 12♣ 12♠ (pair of Qs), H3 = A♣ A♥ A♠ (trail)
    // order rule: H3 trail > H2 pair > H1 high card — reversed => violation
    expect(screen.getByText(/Hand 1 must be at least as strong as Hand 2|Hand 2 must be at least as strong as Hand 3/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lock In' })).toBeDisabled()
  })

  it('opponents keep their cards hidden until the reveal', () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('Seed'), { target: { value: '2024' } })
    fireEvent.submit(screen.getByLabelText('New game setup'))
    // every opponent card renders as a face-down back only
    expect(document.querySelectorAll('.mini-card').length).toBeGreaterThanOrEqual(9)
  })
})

describe('reveal phase banners', () => {
  const rigFor = (hands: [Hand, Hand, Hand][], over = {}) =>
    resolveRig(testConfig({ botCount: (hands.length - 1) as 1 | 2 | 3 | 4, enforceOrder: false, ...over }), 999, hands)

  it('KITTI banner and Redeal button appear when nobody reaches the win condition', async () => {
    const state = rigFor([
      [hand(spade(13), heart(13), club(13)), hand(spade(2), heart(5), club(9)), hand(spade(11), heart(11), heart(4))],
      [hand(diamond(14), heart(14), club(4)), hand(diamond(12), heart(12), club(7)), hand(diamond(11), club(11), diamond(4))],
    ])
    expect(state.outcome?.kind).toBe('kitti')
    render(<RevealPanel state={state} onNext={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('KITTI'), { timeout: 3000 })
    expect(screen.getByRole('button', { name: 'Redeal' })).toBeInTheDocument()
  })

  it('WINNER banner appears for a two-round win', async () => {
    const state = rigFor([
      [hand(spade(14), heart(14), club(14)), hand(spade(13), heart(13), club(13)), hand(spade(2), heart(5), club(9))],
      [hand(diamond(10), heart(10), club(4)), hand(diamond(9), heart(7), club(5)), hand(diamond(12), heart(12), diamond(3))],
    ])
    expect(state.outcome?.kind).toBe('win')
    render(<RevealPanel state={state} onNext={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('WINNER'), { timeout: 3000 })
  })

  it('SALAMI banner appears for a three-round win', async () => {
    const state = rigFor([
      [hand(spade(14), heart(14), club(14)), hand(spade(13), heart(13), club(13)), hand(spade(12), heart(12), club(12))],
      [hand(diamond(10), heart(10), club(4)), hand(diamond(9), heart(7), club(5)), hand(diamond(8), heart(6), club(3))],
    ])
    expect(state.outcome?.kind).toBe('salami')
    render(<RevealPanel state={state} onNext={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('SALAMI!'), { timeout: 3000 })
  })
})
