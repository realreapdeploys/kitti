/** Display helpers for chip amounts. Chips are stored by the engine as INTEGER CENTS (1/100 dollar), so
 *  $1.50 rooms and $0.10 boots are exact — never floats. Format shows whole dollars as $20 and 2dp otherwise. */
export function formatChips(cents: number): string {
  const whole = Math.trunc(cents / 100), rem = Math.abs(cents) % 100
  if (rem === 0) return `$${whole.toLocaleString('en-AU')}`
  return `$${(cents / 100).toFixed(2)}`
}
export const chipsToDollars = (cents: number): number => cents / 100
export const dollarsToChips = (d: number): number => Math.round(d * 100)
