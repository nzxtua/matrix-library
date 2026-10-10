/** `value`, held between `low` and `high`. */
export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
