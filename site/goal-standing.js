// Positive gap means the prediction is slower than the target.
function goalStanding(predictedSec, targetSec) {
  const pred = Math.round(Number(predictedSec));
  const target = Math.round(Number(targetSec));
  if (!(pred > 0) || !(target > 0)) return null;
  const gap = pred - target;
  const clock = formatGap(Math.abs(gap));
  if (gap < 0) return { status: 'ahead', gap, absGap: -gap, pct: 100, label: '領先目標', clock, slogan: '目標已在腳下。守住節奏，把它跑完。' };
  if (gap === 0) return { status: 'even', gap: 0, absGap: 0, pct: 100, label: '剛好達標', clock: '0:00', slogan: '剛好達標。守住這個配速。' };
  const pct = Math.min(99, Math.floor(target / pred * 100));
  const slogan = gap < 8 * 60 ? '還沒到，但已經很近了。再把配速咬住。' : '還沒到目標。每一公里都在把它拉近。';
  return { status: 'behind', gap, absGap: gap, pct, label: '落後目標', clock, slogan };
}
function formatGap(sec) {
  sec = Math.round(Math.abs(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}
