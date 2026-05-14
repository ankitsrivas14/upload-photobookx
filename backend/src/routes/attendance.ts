import { Router, Response } from 'express';
import { requireAdmin } from './adminAuth';
import { Employee, Attendance, SalaryAdvance, SalaryPayment, AttendanceAuditLog } from '../models';
import type { AuthenticatedRequest } from '../types';

async function logAudit(action: string, details: string, employeeId?: string, req?: AuthenticatedRequest) {
  try {
    const adminUser = req?.user?.email || 'System';
    await AttendanceAuditLog.create({ action, details, employeeId, adminUser });
  } catch (error) {
    console.error('Failed to log attendance audit:', error);
  }
}

const router = Router();

// ================= EMPLOYEES =================

// Add new employee
router.post('/employees', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, monthlySalary, joiningDate } = req.body;
    const employee = new Employee({
      name,
      monthlySalary,
      joiningDate: new Date(joiningDate)
    });
    await employee.save();
    
    await logAudit('ADD_EMPLOYEE', `Added employee ${name} with salary ${monthlySalary}`, employee._id.toString(), req);

    res.json({ success: true, employee });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update employee
router.put('/employees/:id', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, monthlySalary, isActive } = req.body;
    const employee = await Employee.findByIdAndUpdate(
      req.params.id,
      { name, monthlySalary, isActive },
      { new: true }
    );
    
    await logAudit('UPDATE_EMPLOYEE', `Updated employee ${name} (Active: ${isActive})`, req.params.id as string, req);

    res.json({ success: true, employee });
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

    const employees = await Employee.find({ isActive: true }).lean();
    const employeeIds = employees.map(e => e._id);

    const attendances = await Attendance.find({
      employeeId: { $in: employeeIds },
      dateStr: { $regex: `^${month}` }
    }).lean();

    const advances = await SalaryAdvance.find({
      employeeId: { $in: employeeIds },
      date: { $gte: startDate, $lte: endDate }
    }).lean();

    const payments = await SalaryPayment.find({
      employeeId: { $in: employeeIds },
      month
    }).lean();

    const stats = employees.map(emp => {
      const empAttendances = attendances.filter(a => a.employeeId.toString() === emp._id.toString());
      const empAdvances = advances.filter(a => a.employeeId.toString() === emp._id.toString());
      const empPayment = payments.find(p => p.employeeId.toString() === emp._id.toString());

      const dailyWage = emp.monthlySalary / daysInMonth;
      
      // Calculate eligible days (days in month on or after joining date)
      let eligibleDaysInMonth = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(year, monthNum - 1, d);
        if (date >= new Date(emp.joiningDate)) {
          eligibleDaysInMonth++;
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

    const records = await Attendance.find({ dateStr });
    res.json({ success: true, records });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all attendance records for a month
router.get('/records/month/:month', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { month } = req.params; // YYYY-MM
    const records = await Attendance.find({
      dateStr: { $regex: new RegExp(`^${month}-`) }
    });
    res.json({ success: true, records });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Mark attendance
router.post('/records', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { employeeId, dateStr, status, notes } = req.body;
    
    if (!status || status === 'none') {
      await Attendance.deleteOne({ employeeId, dateStr });
      await logAudit('CLEAR_ATTENDANCE', `Cleared attendance for ${dateStr}`, employeeId, req);
      return res.json({ success: true, message: 'Attendance removed' });
    }

    const record = await Attendance.findOneAndUpdate(
      { employeeId, dateStr },
      { status, notes },
      { new: true, upsert: true }
    );
    
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
    const advance = new SalaryAdvance({
      employeeId,
      date: new Date(date),
      amount,
      reason
    });
    await advance.save();
    
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
    
    const payment = await SalaryPayment.findOneAndUpdate(
      { employeeId, month },
      { amountPaid, paidAt: new Date() },
      { new: true, upsert: true }
    );
    
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
