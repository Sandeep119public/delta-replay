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
