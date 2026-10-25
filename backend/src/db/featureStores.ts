import { docStore } from './docStore';

/** Firestore stores for the COGS + expenses feature collections (Phase 4). */
export const cogsStore = docStore('cogsConfigurations');
export const dailyAdSpendStore = docStore('dailyAdSpend');
export const metaAdsExpenseStore = docStore('metaAdsExpenses');
export const expenseSourceStore = docStore('expenseSources');
export const fixedMonthlyExpenseStore = docStore('fixedMonthlyExpenses');

// Attendance
export const employeeStore = docStore('employees');
export const attendanceStore = docStore('attendance');
export const salaryAdvanceStore = docStore('salaryAdvances');
export const salaryPaymentStore = docStore('salaryPayments');
export const attendanceAuditStore = docStore('attendanceAuditLogs');
export const hourlyLogStore = docStore('hourlyLogs');

// Bank
export const bankCategoryStore = docStore('bankCategories');
export const bankTransactionStore = docStore('bankTransactions');
export const bankNarrationRuleStore = docStore('bankNarrationRules');

// Smaller features, moved from Mongo. Reels, strategies and predictions keep their Mongo ids;
// the others are keyed by their unique field (template name, settings key, pin code,
// URI-encoded city, or a hash of phone and date for abandoned checkouts).
export const whatsAppTemplateStore = docStore('whatsAppTemplates');
export const abandonedCheckoutStore = docStore('abandonedCheckouts');
export const blockedPinCodeStore = docStore('blockedPinCodes');
export const codAddedCityStore = docStore('codAddedCities');
export const reelStore = docStore('reels');
export const reelStrategyStore = docStore('reelStrategies');
export const profitPredictionStore = docStore('profitPredictions');
export const agencySettingsStore = docStore('agencySettings');
