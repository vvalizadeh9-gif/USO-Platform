/** Space around the plot, shared by the chart and the strips under it so their columns line up. */
export const PAD = { left: 44, right: 12, top: 30, bottom: 28 }

/** The chart's top value: a round, even number at or above the data. */
export function niceMax(value) {
  if (!(value > 0)) return 10
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 3, 4, 5, 6, 8, 10].find((c) => c * magnitude >= value)
  const top = step * magnitude
  return top % 2 === 0 || top >= 100 ? top : top + 1
}
