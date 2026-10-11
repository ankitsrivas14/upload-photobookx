import { Router, Response } from 'express';
import { requireAdmin } from './adminAuth';
import type { AuthenticatedRequest } from '../types';
import {
  employeeStore, attendanceStore, salaryAdvanceStore, salaryPaymentStore,
  attendanceAuditStore, hourlyLogStore,
} from '../db/featureStores';

async function logAudit(action: string, details: string, employeeId?: string, req?: AuthenticatedRequest) {
  try {
    const adminUser = req?.user?.email || 'System';
    await attendanceAuditStore.create({ action, details, employeeId, adminUser, createdAt: new Date() });
  } catch (error) {
    console.error('Failed to log attendance audit:', error);
  }
}

const router = Router();

// ================= EMPLOYEES =================

// Add new employee
router.post('/employees', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, employeeType, monthlySalary, hourlyRate, joiningDate } = req.body;
    const employee = await employeeStore.create({
      name,
      employeeType: employeeType || 'monthly',
      monthlySalary: employeeType === 'hourly' ? 0 : (monthlySalary || 0),
      hourlyRate: employeeType === 'hourly' ? (hourlyRate || 0) : 0,
      joiningDate: new Date(joiningDate),
      isActive: true,
      createdAt: new Date(),
    });

    const details = employeeType === 'hourly'
      ? `Added hourly employee ${name} at ₹${hourlyRate}/hr`
      : `Added employee ${name} with salary ₹${monthlySalary}/month`;
    await logAudit('ADD_EMPLOYEE', details, employee._id.toString(), req);

    res.json({ success: true, employee });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update employee
router.put('/employees/:id', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, monthlySalary, isActive, terminationDate, isFnfMarked, fnfAmount, hourlyRate } = req.body;
    
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (monthlySalary !== undefined) updateData.monthlySalary = monthlySalary;
    if (hourlyRate !== undefined) updateData.hourlyRate = hourlyRate;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (terminationDate !== undefined) updateData.terminationDate = terminationDate ? new Date(terminationDate) : null;
    if (isFnfMarked !== undefined) updateData.isFnfMarked = isFnfMarked;
    if (fnfAmount !== undefined) updateData.fnfAmount = fnfAmount;

    const employee = await employeeStore.updateById(String(req.params.id), updateData);

    await logAudit('UPDATE_EMPLOYEE', `Updated employee ${name} (Active: ${isActive})`, req.params.id as string, req);

    res.json({ success: true, employee });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all employees (for management tab)
router.get('/employees', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const employees = (await employeeStore.all()).sort((a, b) => {
      const act = (b.isActive ? 1 : 0) - (a.isActive ? 1 : 0);
      return act !== 0 ? act : new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
    res.json({ success: true, employees });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get employees with monthly stats
router.get('/employees/stats', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const month = req.query.month as string; // YYYY-MM
    if (!month) return res.status(400).json({ success: false, error: 'Month is required' });

    const [year, monthNum] = month.split('-').map(Number);
    // Use local time approximations
    const startDate = new Date(year, monthNum - 1, 1);
    const endDate = new Date(year, monthNum, 0, 23, 59, 59);
    const daysInMonth = endDate.getDate();

    const employeesData = (await employeeStore.all()).filter((e) => e.employeeType !== 'hourly');

    // Only include active employees, or those terminated on/after the start of this month
    const employees = employeesData.filter(emp => {
      if (new Date(emp.joiningDate) > endDate) return false; // Joined after this month ends
      if (emp.isActive) return true;
      if (emp.terminationDate) {
        if (new Date(emp.terminationDate) >= startDate) return true;
      }
      return false;
    });

    // Scope by month/range, then group per-employee in JS (Firestore `in` caps at 30).
    const attendances = await attendanceStore.prefix('dateStr', month);
    const advances = await salaryAdvanceStore.query([['date', '>=', startDate], ['date', '<=', endDate]]);
    const payments = await salaryPaymentStore.where('month', '==', month);

    const stats = employees.map(emp => {
      const empAttendances = attendances.filter(a => a.employeeId.toString() === emp._id.toString());
      const empAdvances = advances.filter(a => a.employeeId.toString() === emp._id.toString());
      const empPayment = payments.find(p => p.employeeId.toString() === emp._id.toString());

      const dailyWage = emp.monthlySalary / daysInMonth;
      
      // Calculate eligible days (days in month on or after joining date and on or before termination date)
      let eligibleDaysInMonth = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(year, monthNum - 1, d);
        // Start counting from joining date
        if (date >= new Date(new Date(emp.joiningDate).setHours(0,0,0,0))) {
          // Stop counting after termination date
          if (!emp.terminationDate || date <= new Date(new Date(emp.terminationDate).setHours(0,0,0,0))) {
            eligibleDaysInMonth++;
          }
        }
      }

      const proratedBaseSalary = Math.round(dailyWage * eligibleDaysInMonth);
      
      let absentDays = 0;
      let halfDays = 0;
      let presentDays = 0;

      empAttendances.forEach(a => {
        const d = new Date(a.dateStr);
        // Sundays are official holidays, no cut. 
        if (d.getDay() === 0) return; 

        if (a.status === 'absent') absentDays++;
        if (a.status === 'half-day') halfDays++;
        if (a.status === 'present') presentDays++;
      });

      const deductions = Math.round((absentDays * dailyWage) + (halfDays * (dailyWage / 2)));
      const totalAdvances = empAdvances.reduce((sum, a) => sum + a.amount, 0);
      const netSalary = Math.round(proratedBaseSalary - deductions - totalAdvances);

      return {
        ...emp,
        stats: {
          presentDays,
          absentDays,
          halfDays,
          deductions,
          totalAdvances,
          netSalary,
          proratedBaseSalary,
          isPaid: !!empPayment,
          paidAmount: empPayment ? empPayment.amountPaid : 0
        }
      };
    });

    res.json({ success: true, employees: stats });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ================= ATTENDANCE =================

// Get attendance for a specific date
router.get('/records', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { dateStr } = req.query;
    if (!dateStr) return res.status(400).json({ success: false, error: 'dateStr is required' });

    const records = await attendanceStore.where('dateStr', '==', dateStr);
    res.json({ success: true, records });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all attendance records for a month
router.get('/records/month/:month', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { month } = req.params; // YYYY-MM
    const records = await attendanceStore.prefix('dateStr', `${month}-`);
    res.json({ success: true, records });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Mark attendance
router.post('/records', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { employeeId, dateStr, status, notes } = req.body;
    
    const existingAtt = await attendanceStore.query([['employeeId', '==', employeeId], ['dateStr', '==', dateStr]]);
    if (!status || status === 'none') {
      for (const e of existingAtt) await attendanceStore.deleteById(e._id);
      await logAudit('CLEAR_ATTENDANCE', `Cleared attendance for ${dateStr}`, employeeId, req);
      return res.json({ success: true, message: 'Attendance removed' });
    }

    const record = existingAtt.length
      ? await attendanceStore.updateById(existingAtt[0]._id, { status, notes })
      : await attendanceStore.create({ employeeId, dateStr, status, notes, createdAt: new Date() });
    
    await logAudit('MARK_ATTENDANCE', `Marked attendance as ${status} for ${dateStr}`, employeeId, req);

    res.json({ success: true, record });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ================= ADVANCES =================

// Add advance
router.post('/advances', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { employeeId, date, amount, reason } = req.body;
    const advance = await salaryAdvanceStore.create({
      employeeId,
      date: new Date(date),
      amount,
      reason,
      createdAt: new Date(),
    });
    
    await logAudit('ADD_ADVANCE', `Added advance of ${amount} for reason: ${reason}`, employeeId, req);

    res.json({ success: true, advance });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ================= PAYMENTS =================

// Mark as paid
router.post('/payments', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { employeeId, month, amountPaid } = req.body;
    
    const existingPay = await salaryPaymentStore.query([['employeeId', '==', employeeId], ['month', '==', month]]);
    const payment = existingPay.length
      ? await salaryPaymentStore.updateById(existingPay[0]._id, { amountPaid, paidAt: new Date() })
      : await salaryPaymentStore.create({ employeeId, month, amountPaid, paidAt: new Date(), createdAt: new Date() });

    await logAudit('MARK_PAID', `Marked salary as paid (${amountPaid}) for month ${month}`, employeeId, req);

    res.json({ success: true, payment });
  } catch (error: any) {
    if (error.code === 11000) {
       return res.status(400).json({ success: false, error: 'Payment already recorded for this month.' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

// ================= HOURLY LOGS =================

// Log or update hours worked for an hourly employee
router.post('/hourly-logs', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { employeeId, dateStr, hoursWorked, notes } = req.body;
    if (hoursWorked < 0 || hoursWorked > 24) {
      return res.status(400).json({ success: false, error: 'Hours must be between 0 and 24' });
    }
    
    const existingLog = await hourlyLogStore.query([['employeeId', '==', employeeId], ['dateStr', '==', dateStr]]);
    const log = existingLog.length
      ? await hourlyLogStore.updateById(existingLog[0]._id, { hoursWorked, notes })
      : await hourlyLogStore.create({ employeeId, dateStr, hoursWorked, notes, createdAt: new Date() });

    await logAudit('LOG_HOURS', `Logged ${hoursWorked}h for ${dateStr}`, employeeId, req);
    
    res.json({ success: true, log });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete a hourly log entry
router.delete('/hourly-logs/:employeeId/:dateStr', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { employeeId, dateStr } = req.params;
    const toDelete = await hourlyLogStore.query([['employeeId', '==', employeeId], ['dateStr', '==', dateStr]]);
    for (const e of toDelete) await hourlyLogStore.deleteById(e._id);
    await logAudit('DELETE_HOURS_LOG', `Deleted hours log for ${dateStr}`, employeeId as string, req);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get monthly hourly logs for all hourly employees
router.get('/hourly-logs/month/:month', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { month } = req.params; // YYYY-MM
    const employees = (await employeeStore.all()).filter((e) => e.isActive && e.employeeType === 'hourly');
    const logs = await hourlyLogStore.prefix('dateStr', `${month}-`);
    const payments = await salaryPaymentStore.where('month', '==', month);

    const summary = employees.map(emp => {
      const empLogs = logs.filter(l => l.employeeId.toString() === emp._id.toString());
      const totalHours = empLogs.reduce((sum, l) => sum + l.hoursWorked, 0);
      const totalEarnings = Math.round(totalHours * emp.hourlyRate);
      const payment = payments.find(p => p.employeeId.toString() === emp._id.toString());

      return {
        ...emp,
        logs: empLogs,
        totalHours,
        totalEarnings,
        isPaid: !!payment,
        paidAmount: payment?.amountPaid || 0,
      };
    });

    res.json({ success: true, employees: summary });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all hourly logs (all time) grouped by employee, for the records table
router.get('/hourly-logs/all', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const employees = (await employeeStore.all()).filter((e) => e.isActive && e.employeeType === 'hourly');
    const empIds = new Set(employees.map((e) => String(e._id)));
    const logs = (await hourlyLogStore.all())
      .filter((l) => empIds.has(String(l.employeeId)))
      .sort((a, b) => String(b.dateStr).localeCompare(String(a.dateStr)));

    res.json({ success: true, employees, logs });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});
