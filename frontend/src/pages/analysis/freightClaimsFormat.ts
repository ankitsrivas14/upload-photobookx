// Stage labels, badge tones and dates shared by Analysis › Freight claims and its order page.
import type { Tone } from '../../components/ui/pbx';
import type { ClaimStatus } from '../../services/api';

export const CLAIM_LABEL: Record<ClaimStatus, string> = {
    not_started: 'Not started',
    asked_reason: 'Asked why',
    needs_you: 'Needs you',
    refund_requested: 'Refund asked',
    refund_promised: 'Refund promised',
    refund_received: 'Refunded',
    customer_fault: "Customer's fault",
};

export const CLAIM_TONE: Record<ClaimStatus, Tone> = {
    not_started: 'neutral',
    asked_reason: 'info',
    needs_you: 'negative',
    refund_requested: 'brand',
    refund_promised: 'caution',
    refund_received: 'positive',
    customer_fault: 'neutral',
};

/** What each stage means, for the order page. */
export const CLAIM_HINT: Record<ClaimStatus, string> = {
    not_started: 'No ticket yet.',
    asked_reason: 'We asked Shiprocket why it was not delivered and are waiting for their answer.',
    needs_you: 'Shiprocket asked for something only you can give.',
    refund_requested: 'The failure was not the customer’s, so we are asking for the forward and RTO freight back.',
    refund_promised: 'Shiprocket agreed to refund; we check the wallet until it arrives.',
    refund_received: 'The refund is in the wallet.',
    customer_fault: 'The customer caused the failure, so there is nothing to claim.',
};

/** Stages with a ticket still in play. */
export const OPEN_STAGES: ClaimStatus[] = ['asked_reason', 'needs_you', 'refund_requested', 'refund_promised'];
/** Stages that need nothing more. */
export const CLOSED_STAGES: ClaimStatus[] = ['refund_received', 'customer_fault'];

/** A day in India, e.g. "29 Sep". */
export const dayIst = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }) : '–';
