/**
 * Record a shelf count of the stocked books, taken after the day's shipments:
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=<service-account key> npx tsx scripts/setStock.ts \
 *     jl-large=240 jl-small=398 dham-large=11 dham-small=11
 *
 * Books in orders still waiting to ship are noted with the count; the admin's stock alert works
 * out what is left from there (GET /api/admin/stock).
 */
import { recordStockCounts, STOCK_ITEMS, type StockSku } from '../src/services/stockService';

async function main() {
  const skus: string[] = STOCK_ITEMS.map((i) => i.sku);
  const usage = `Use ${skus.map((s) => `${s}=<books>`).join(' ')}.`;
  const counts: Partial<Record<StockSku, number>> = {};
  for (const arg of process.argv.slice(2)) {
    const m = /^([a-z-]+)=(\d+)$/.exec(arg);
    if (!m || !skus.includes(m[1])) throw new Error(`Can't read "${arg}". ${usage}`);
    counts[m[1] as StockSku] = Number(m[2]);
  }
  if (!Object.keys(counts).length) throw new Error(`Nothing to record. ${usage}`);
  for (const c of await recordStockCounts(counts)) {
    console.log(`${c.sku}: ${c.count} on the shelf, ${c.committed} of them in orders waiting to ship (counted ${c.countedAt})`);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e.message);
    process.exit(1);
  }
);
