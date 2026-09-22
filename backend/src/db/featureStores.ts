import { docStore } from './docStore';

/** Firestore stores for the COGS + expenses feature collections (Phase 4). */
export const cogsStore = docStore('cogsConfigurations');
export const dailyAdSpendStore = docStore('dailyAdSpend');
export const metaAdsExpenseStore = docStore('metaAdsExpenses');
export const expenseSourceStore = docStore('expenseSources');
export const fixedMonthlyExpenseStore = docStore('fixedMonthlyExpenses');
