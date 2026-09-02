export function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const d = new Date(seconds * 1000);
  // Use UTC to match typical market data; but show local string as fallback
  // Format: YYYY-MM-DD HH:mm UTC
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export function formatShort(seconds) {
  const d = new Date(seconds * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function toUnixSeconds(dateStr, timeStr) {
  // dateStr: YYYY-MM-DD, timeStr: HH:mm  (both UTC)
  if (!dateStr) throw new Error('date required');
  const t = (timeStr || '00:00').trim();
  const [hh, mm] = t.split(':').map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) throw new Error(`Invalid time: ${timeStr}`);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) throw new Error(`Invalid time: ${timeStr} (hh 0-23, mm 0-59)`);
  const [yy, mo, dd] = dateStr.split('-').map(Number);
  if (![yy, mo, dd].every(Number.isFinite)) throw new Error(`Invalid date: ${dateStr}`);
  // Validate real calendar date via UTC round-trip
  const ms = Date.UTC(yy, mo - 1, dd, hh, mm, 0, 0);
  if (!Number.isFinite(ms)) throw new Error(`Invalid datetime: ${dateStr} ${timeStr}`);
  const check = new Date(ms);
  if (check.getUTCFullYear()!==yy || check.getUTCMonth()!==mo-1 || check.getUTCDate()!==dd) throw new Error(`Invalid date: ${dateStr}`);
  return Math.floor(ms / 1000);
}

export function unixToDateTimeInput(unixSec) {
  const d = new Date(unixSec * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  const mm = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}` };
}

export function intervalToLabel(tf) {
  return tf;
}
