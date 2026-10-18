/** Trip identity palette, legible on the dark globe. */
export const TRIP_COLORS = [
  '#f59e0b',
  '#2dd4bf',
  '#a78bfa',
  '#fb7185',
  '#60a5fa',
  '#f472b6',
  '#a3e635',
  '#22d3ee',
  '#fb923c',
  '#fbbf24',
  '#4ade80',
  '#818cf8',
];

/** First palette color not used by another trip, else the least-used one. */
export function nextTripColor(used = []) {
  return (
    TRIP_COLORS.find((c) => !used.includes(c)) ||
    TRIP_COLORS[used.length % TRIP_COLORS.length]
  );
}
