// Plain helpers shared by the components and by pages; kept apart so pbx.tsx exports only components.

/** Joins class names, skipping falsy values. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export interface FormatINROptions { decimals?: number; compact?: boolean; signed?: boolean; currency?: string }

/** Indian-grouped rupees: 1234567 → ₹12,34,567; compact → ₹12.3L, ₹1.2Cr; signed → +₹/−₹ (true minus sign). */
export function formatINR(value: number, options: FormatINROptions = {}): string {
  const { decimals = 0, compact = false, signed = false, currency = '₹' } = options;
  const abs = Math.abs(value);
  const short = (n: number, unit: string) => (n >= 100 ? n.toFixed(0) : n.toFixed(1).replace(/\.0$/, '')) + unit;
  let body: string;
  if (compact && abs >= 1e7) body = short(abs / 1e7, 'Cr');
  else if (compact && abs >= 1e5) body = short(abs / 1e5, 'L');
  else if (compact && abs >= 1e3) body = short(abs / 1e3, 'K');
  else body = abs.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const sign = value < 0 ? '−' : signed && value > 0 ? '+' : '';
  return sign + currency + body;
}
