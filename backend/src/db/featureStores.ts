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
