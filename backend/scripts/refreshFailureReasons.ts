/**
 * Re-read failed Shiprocket orders and why each failed into Firestore, for Analysis › Failure reasons. The nightly
 * failureReasonsSync covers the last three months; use --from to backfill older ones:
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=<service-account key> SHIPROCKET_API_EMAIL=… SHIPROCKET_API_PASSWORD=… \
 *     npx tsx scripts/refreshFailureReasons.ts --from 2026-01
 *
 * It only reads Shiprocket. Running it again reads tracking only for orders still without a reason.
 */
import { refreshFailureReasons } from '../src/services/failureReasonsService';

async function main() {
  const at = process.argv.indexOf('--from');
  const fromMonth = at > 0 ? process.argv[at + 1] : undefined;
  if (fromMonth !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(fromMonth)) {
    throw new Error('--from takes a month, e.g. --from 2026-01');
  }
  const { months, failed, tracked, removed } = await refreshFailureReasons({ fromMonth });
  console.log(`${months[0]} to ${months.at(-1)}: ${failed} failed orders, ${tracked} reasons read, ${removed} removed`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e.message);
    process.exit(1);
  }
);
