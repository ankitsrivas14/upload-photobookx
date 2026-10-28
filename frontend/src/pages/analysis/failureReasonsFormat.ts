// Labels and figures shared by Analysis › Failure reasons and its month page.
import type { FailureMonth } from '../../services/api';

/** Short names for the reason groups, for table headers and filter tabs. */
const SHORT_GROUP: Record<string, string> = {
    'Refused or cancelled at the door': 'Refused',
    'Not available or not reachable': 'Not reachable',
    'Address or pincode problem': 'Address',
    'Wanted a later delivery': 'Later delivery',
    'COD cash not ready': 'Cash not ready',
    'Courier side': 'Courier side',
    Other: 'Other',
};

export const shortGroup = (group: string) => SHORT_GROUP[group] ?? group;

export const fmt = (n: number) => n.toLocaleString('en-IN');

/** "September 2026", or "Sep" with `short`. */
export function monthLabel(month: string, short = false): string {
    const [y, m] = month.split('-').map(Number);
    if (!y || !m) return month;
    return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(
        'en-IN',
        short ? { month: 'short', timeZone: 'UTC' } : { month: 'long', year: 'numeric', timeZone: 'UTC' },
    );
}

/** Failed out of delivered plus failed, as a fraction; null when none of the orders has finished. */
export function failRate(m: Pick<FailureMonth, 'failed' | 'delivered'>): number | null {
    const finished = m.failed + m.delivered;
    return finished > 0 ? m.failed / finished : null;
}

export const pct = (rate: number | null, digits = 1) => (rate == null ? '–' : `${(rate * 100).toFixed(digits)}%`);

/** A date and time in India, e.g. "28 Oct, 4:43 pm". */
export function istWhen(iso: string | null | undefined): string {
    if (!iso) return '–';
    return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
