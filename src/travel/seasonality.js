/** Pure comfort-index helpers. Scores are 0-100 per month, 0 = January. */
export const MONTH_ABBR = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];
export const COMFORT_LABELS = [
  'HARSH',
  'THIN',
  'MILD',
  'FAIR',
  'GOOD',
  'PRIME',
];

/** Temperature comfort band 18-26 °C, rain penalty 0-35 over 30-250 mm. */
export function comfortScore(tempC, precipMm) {
  let t;
  if (tempC >= 18 && tempC <= 26) t = 100;
  else if (tempC < 18) t = (100 * (tempC + 5)) / 23;
  else t = (100 * (40 - tempC)) / 14;
  t = Math.min(100, Math.max(0, t));
  const penalty =
    precipMm <= 30 ? 0 : precipMm >= 250 ? 35 : (35 * (precipMm - 30)) / 220;
  return Math.round(Math.min(100, Math.max(0, t - penalty)));
}

/** score → bin 0..5; colors live in CSS (--heat-b0..b5). */
export function comfortBin(score) {
  if (score >= 84) return 5;
  if (score >= 67) return 4;
  if (score >= 51) return 3;
  if (score >= 34) return 2;
  if (score >= 17) return 1;
  return 0;
}

const CANDIDATE_MARGIN = 8;

/**
 * Longest contiguous run of months within 8 points of the peak, wrap-aware.
 * @param {Array<{score:number}>} months 12 entries
 * @returns {{startMonth:number,endMonth:number,peakMonth:number,isWrap:boolean}|null}
 */
export function bestWindow(months) {
  if (!Array.isArray(months) || months.length !== 12) return null;
  const scores = months.map((m) => m.score);
  const max = Math.max(...scores);
  const cand = scores.map((s) => s >= max - CANDIDATE_MARGIN);
  const globalPeak = scores.indexOf(max);
  if (cand.every(Boolean))
    return {
      startMonth: 0,
      endMonth: 11,
      peakMonth: globalPeak,
      isWrap: false,
    };
  const runs = [];
  for (let i = 0; i < 12; i++) {
    if (cand[i] && !cand[(i + 11) % 12]) {
      let len = 0;
      while (len < 12 && cand[(i + len) % 12]) len++;
      runs.push({ start: i, len });
    }
  }
  const holds = (r, m) => (m - r.start + 12) % 12 < r.len;
  runs.sort(
    (a, b) =>
      b.len - a.len ||
      Number(holds(b, globalPeak)) - Number(holds(a, globalPeak)) ||
      a.start - b.start,
  );
  const best = runs[0];
  const endMonth = (best.start + best.len - 1) % 12;
  let peakMonth = best.start;
  for (let k = 0; k < best.len; k++) {
    const m = (best.start + k) % 12;
    if (scores[m] > scores[peakMonth]) peakMonth = m;
  }
  return {
    startMonth: best.start,
    endMonth,
    peakMonth,
    isWrap: endMonth < best.start,
  };
}

export function isMonthInWindow(win, month) {
  if (!win) return false;
  const { startMonth: s, endMonth: e } = win;
  return s <= e ? month >= s && month <= e : month >= s || month <= e;
}

/** "MAY–SEP", "MAY", or "—". */
export function formatBestSpan(win) {
  if (!win) return '—';
  if (win.startMonth === win.endMonth) return MONTH_ABBR[win.startMonth];
  return `${MONTH_ABBR[win.startMonth]}–${MONTH_ABBR[win.endMonth]}`;
}
