import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { api } from '../services/api';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  DataList,
  Dialog,
  Drawer,
  EmptyState,
  PageHeader,
  SegmentedControl,
  Select,
  Skeleton,
  StatCard,
  StatStrip,
  Tabs,
  TextField,
} from '../components/ui/pbx';
import { cx, formatINR } from '../components/ui/format';
import styles from './AttendancePage.module.css';

interface EmployeeStat {
  _id: string;
  name: string;
  monthlySalary: number;
  joiningDate: string;
  isActive: boolean;
  terminationDate?: string;
  stats: {
    presentDays: number;
    absentDays: number;
    halfDays: number;
    deductions: number;
    totalAdvances: number;
    netSalary: number;
    proratedBaseSalary?: number;
    isPaid: boolean;
    paidAmount: number;
  };
}

interface Employee {
  _id: string;
  name: string;
  employeeType: 'monthly' | 'hourly';
  monthlySalary?: number;
  hourlyRate?: number;
  joiningDate: string;
  isActive: boolean;
  terminationDate?: string;
  isFnfMarked?: boolean;
  fnfAmount?: number;
}

interface HourlyEmployee {
  _id: string;
  name: string;
  hourlyRate: number;
  isPaid?: boolean;
}

interface HourlyLog {
  employeeId: string;
  dateStr: string;
  hoursWorked: number;
  notes?: string;
}

type Tab = 'attendance' | 'hourly' | 'salary' | 'employees';
type DayStatus = 'none' | 'present' | 'half-day' | 'absent' | 'holiday';

const TABS = [
  { id: 'attendance', label: 'Attendance register' },
  { id: 'hourly', label: 'Hourly workers' },
  { id: 'salary', label: 'Salary and advances' },
  { id: 'employees', label: 'Manage employees' },
];

// Register cells: the letter always shows; the colour only backs it up
const CELL: Record<DayStatus, { letter: string; label: string; className: string }> = {
  present: { letter: 'P', label: 'Present', className: styles.present },
  'half-day': { letter: 'H', label: 'Half day', className: styles.half },
  absent: { letter: 'A', label: 'Absent', className: styles.absent },
  holiday: { letter: 'S', label: 'Sunday off', className: styles.holiday },
  none: { letter: '·', label: 'Not marked', className: styles.unmarked },
};

export function AttendancePage() {
  const [activeTab, setActiveTab] = useState<Tab>('attendance');
  const [monthStr, setMonthStr] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  // Monthly Attendance Grid State
  const [monthlyRecords, setMonthlyRecords] = useState<Record<string, Record<string, string>>>({});

  // Monthly Employees & Stats
  const [employees, setEmployees] = useState<EmployeeStat[]>([]);
  const [loading, setLoading] = useState(false);

  // Hourly Employees State
  const [hourlyEmployees, setHourlyEmployees] = useState<HourlyEmployee[]>([]);
  const [allHourlyLogs, setAllHourlyLogs] = useState<HourlyLog[]>([]);
  const [logForm, setLogForm] = useState({ employeeId: '', dateStr: new Date().toISOString().split('T')[0], hoursWorked: '', notes: '' });
  const [submittingLog, setSubmittingLog] = useState(false);

  // Modals
  const [showEmployeeModal, setShowEmployeeModal] = useState(false);
  const [showAdvanceModal, setShowAdvanceModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<string>('');
  const [allEmployeesList, setAllEmployeesList] = useState<Employee[]>([]);
  // The salary row whose computation is open in the drawer
  const [salaryEmployee, setSalaryEmployee] = useState<EmployeeStat | null>(null);
  // A confirmation waiting in a Dialog (mark paid, delete a log)
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    danger?: boolean;
    run: () => void;
  } | null>(null);

  // Form states
  const [empForm, setEmpForm] = useState({ name: '', employeeType: 'monthly' as 'monthly' | 'hourly', monthlySalary: '', hourlyRate: '', joiningDate: '' });
  const [advForm, setAdvForm] = useState({ amount: '', reason: '' });
  const [statusForm, setStatusForm] = useState({ employeeId: '', name: '', isActive: true, terminationDate: '', isFnfMarked: false, fnfAmount: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getEmployeesStats(monthStr);
      if (res.success && res.employees) {
        setEmployees(res.employees as EmployeeStat[]);
      }
    } catch {
      toast.error('Failed to load employee stats');
    } finally {
      setLoading(false);
    }
  }, [monthStr]);

  const loadAllEmployees = useCallback(async () => {
    try {
      const res = await api.getAllEmployees();
      if (res.success && res.employees) {
        setAllEmployeesList(res.employees as Employee[]);
      }
    } catch {
      toast.error('Failed to load all employees');
    }
  }, []);

  const loadHourlyData = useCallback(async () => {
    try {
      const res = await api.getAllHourlyLogs();
      if (res.success) {
        setHourlyEmployees((res.employees || []) as HourlyEmployee[]);
        setAllHourlyLogs((res.logs || []) as HourlyLog[]);
      }
    } catch {
      toast.error('Failed to load hourly logs');
    }
  }, []);

  const loadMonthlyData = useCallback(async () => {
    try {
      const res = await api.getMonthlyAttendance(monthStr);
      if (res.success && res.records) {
        const map: Record<string, Record<string, string>> = {};
        (res.records as Array<{ dateStr: string; employeeId: string; status: string }>).forEach((r) => {
          if (!map[r.dateStr]) map[r.dateStr] = {};
          map[r.dateStr][r.employeeId] = r.status;
        });
        setMonthlyRecords(map);
      }
    } catch {
      toast.error('Failed to load monthly attendance');
    }
  }, [monthStr]);

  useEffect(() => {
    loadData();
    if (activeTab === 'attendance') loadMonthlyData();
    if (activeTab === 'hourly') loadHourlyData();
    if (activeTab === 'employees') loadAllEmployees();
  }, [loadData, loadMonthlyData, loadHourlyData, loadAllEmployees, activeTab]);

  const markMonthlyAttendance = async (empId: string, dateStr: string, currentStatus: string) => {
    const isSunday = new Date(dateStr).getDay() === 0;
    const statuses = isSunday ? ['holiday', 'present', 'half-day'] : ['none', 'present', 'half-day', 'absent'];

    let currentIndex = statuses.indexOf(currentStatus);
    if (currentIndex === -1) currentIndex = 0;

    const nextStatus = statuses[(currentIndex + 1) % statuses.length];

    try {
      setMonthlyRecords(prev => ({
        ...prev,
        [dateStr]: {
          ...(prev[dateStr] || {}),
          [empId]: nextStatus
        }
      }));
      await api.markAttendance(empId, dateStr, nextStatus);
      loadData(); // refresh salary stats
    } catch {
      toast.error('Failed to update attendance');
    }
  };

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.addEmployee(
        empForm.name,
        empForm.joiningDate,
        empForm.employeeType,
        empForm.employeeType === 'monthly' ? Number(empForm.monthlySalary) : undefined,
        empForm.employeeType === 'hourly' ? Number(empForm.hourlyRate) : undefined
      );
      toast.success('Employee added');
      setShowEmployeeModal(false);
      setEmpForm({ name: '', employeeType: 'monthly', monthlySalary: '', hourlyRate: '', joiningDate: '' });
      loadData();
      loadHourlyData();
      loadAllEmployees();
    } catch {
      toast.error('Failed to add employee');
    }
  };

  const handleLogHours = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!logForm.employeeId || !logForm.dateStr || !logForm.hoursWorked) return;
    setSubmittingLog(true);
    try {
      await api.logHours(logForm.employeeId, logForm.dateStr, Number(logForm.hoursWorked), logForm.notes);
      toast.success(`${logForm.hoursWorked}h logged successfully`);
      setLogForm(f => ({ ...f, hoursWorked: '', notes: '' }));
      loadHourlyData();
    } catch {
      toast.error('Failed to log hours');
    } finally {
      setSubmittingLog(false);
    }
  };

  const handleDeleteLog = async (empId: string, dateStr: string) => {
    try {
      await api.deleteHourlyLog(empId, dateStr);
      toast.success('Log deleted');
      loadHourlyData();
    } catch {
      toast.error('Failed to delete log');
    }
  };

  const handleAddAdvance = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Use current date for advance
      const today = new Date().toISOString().split('T')[0];
      await api.addSalaryAdvance(selectedEmployee, today, Number(advForm.amount), advForm.reason);
      toast.success('Advance recorded');
      setShowAdvanceModal(false);
      setAdvForm({ amount: '', reason: '' });
      loadData();
    } catch {
      toast.error('Failed to record advance');
    }
  };

  const handleStatusSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.updateEmployee(statusForm.employeeId, {
        isActive: statusForm.isActive,
        terminationDate: statusForm.isActive ? null : statusForm.terminationDate,
        isFnfMarked: statusForm.isActive ? false : statusForm.isFnfMarked,
        fnfAmount: statusForm.isActive || !statusForm.isFnfMarked ? null : Number(statusForm.fnfAmount)
      });
      toast.success('Employee status updated');
      setShowStatusModal(false);
      loadAllEmployees();
      loadData();
    } catch {
      toast.error('Failed to update employee status');
    }
  };

  const handleMarkPaid = async (empId: string, amount: number) => {
    try {
      await api.markSalaryPaid(empId, monthStr, amount);
      toast.success('Salary marked as paid');
      loadData();
      loadHourlyData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to mark as paid');
    }
  };

  const getDaysInMonth = (monthStr: string) => {
    const [year, month] = monthStr.split('-').map(Number);
    return new Date(year, month, 0).getDate();
  };

  const daysCount = getDaysInMonth(monthStr);
  const todayStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
  const monthDays = Array.from({ length: daysCount }, (_, i) => `${monthStr}-${String(i + 1).padStart(2, '0')}`);
  const monthLabel = new Date(`${monthStr}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  const confirmMarkPaid = (empId: string, amount: number, name: string) => setConfirmAction({
    title: `Mark ${name}'s salary as paid?`,
    description: `${formatINR(amount)} for ${monthLabel}.`,
    confirmLabel: 'Mark paid',
    run: () => handleMarkPaid(empId, amount),
  });

  const confirmDeleteLog = (empId: string, dateStr: string) => setConfirmAction({
    title: 'Delete this log entry?',
    description: `The hours logged on ${new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}.`,
    confirmLabel: 'Delete',
    danger: true,
    run: () => handleDeleteLog(empId, dateStr),
  });

  // Month figures for the strip
  const unpaid = employees.filter((e) => !e.stats.isPaid);
  const salaryDue = unpaid.reduce((s, e) => s + e.stats.netSalary, 0);
  const advances = employees.reduce((s, e) => s + e.stats.totalAdvances, 0);
  const paidAmount = employees.reduce((s, e) => s + (e.stats.isPaid ? e.stats.paidAmount : 0), 0);

  // Hourly logs: { 'YYYY-MM': { empId: { emp, logs[] } } }, newest month first
  const hourlyMonths: Record<string, Record<string, { emp: HourlyEmployee; logs: HourlyLog[] }>> = {};
  allHourlyLogs.forEach((log) => {
    const month = log.dateStr.substring(0, 7);
    const emp = hourlyEmployees.find((e) => e._id === log.employeeId.toString() || e._id.toString() === log.employeeId.toString());
    if (!emp) return;
    if (!hourlyMonths[month]) hourlyMonths[month] = {};
    if (!hourlyMonths[month][emp._id]) hourlyMonths[month][emp._id] = { emp, logs: [] };
    hourlyMonths[month][emp._id].logs.push(log);
  });
  const sortedHourlyMonths = Object.keys(hourlyMonths).sort((a, b) => b.localeCompare(a));

  const noStaff = (
    <EmptyState
      icon="users"
      title="No monthly staff for this month"
      description="Add employees in Manage employees."
      action={<Button size="sm" onClick={() => setActiveTab('employees')}>Manage employees</Button>}
    />
  );

  return (
    <div className={styles.page}>
      <PageHeader
        title="Staff attendance"
        description="Attendance register, hourly hours, salaries and advances, and the staff list."
        actions={
          <label className={styles.monthField}>
            <span>Month</span>
            <span className="pbx-input pbx-input--sm">
              <input type="month" value={monthStr} onChange={(e) => e.target.value && setMonthStr(e.target.value)} />
            </span>
          </label>
        }
      >
        <Tabs label="Staff attendance sections" items={TABS} value={activeTab} onChange={(id) => setActiveTab(id as Tab)} />
      </PageHeader>

      <StatStrip>
        <StatCard label={`Monthly staff · ${monthLabel}`} value={employees.length.toLocaleString('en-IN')} loading={loading && employees.length === 0} />
        <StatCard label="Salary due" value={formatINR(salaryDue)} tone={salaryDue > 0 ? 'caution' : 'neutral'} sub={`${unpaid.length} unpaid`} loading={loading && employees.length === 0} />
        <StatCard label="Advances" value={formatINR(advances)} sub="taken this month" loading={loading && employees.length === 0} />
        <StatCard label="Paid" value={`${employees.length - unpaid.length} of ${employees.length}`} sub={`${formatINR(paidAmount)} paid out`} loading={loading && employees.length === 0} />
      </StatStrip>

      {activeTab === 'attendance' && (
        <Card
          title={`Attendance register · ${monthLabel}`}
          eyebrow="click a cell to change it"
          padding="sm"
          footer={
            <span className={styles.legend}>
              {(['present', 'half-day', 'absent', 'holiday', 'none'] as DayStatus[]).map((s) => (
                <span key={s} className={styles.legendItem}>
                  <span className={cx(styles.mark, styles.markStatic, CELL[s].className)} aria-hidden="true">{CELL[s].letter}</span>
                  {CELL[s].label}
                </span>
              ))}
              <span className={styles.legendItem}><span className={styles.na} aria-hidden="true">–</span>Before joining</span>
              <span className={styles.legendItem}><span className={styles.terminated} aria-hidden="true">T</span>After termination</span>
            </span>
          }
        >
          {loading && employees.length === 0 ? (
            <Skeleton lines={5} />
          ) : employees.length === 0 ? (
            noStaff
          ) : (
            <div className={cx('pbx-table', styles.register)}>
              <div className="pbx-table__scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col" className={styles.nameCol}>Employee</th>
                      {monthDays.map((dateStr) => {
                        const dateObj = new Date(dateStr);
                        return (
                          <th key={dateStr} scope="col" className={cx(styles.dayCol, dateObj.getDay() === 0 && styles.sunday)}>
                            <span className={styles.dayNum}>{Number(dateStr.slice(8))}</span>
                            <span className={styles.dayName}>{dateObj.toLocaleDateString('en-US', { weekday: 'narrow' })}</span>
                          </th>
                        );
                      })}
                      <th scope="col" className={styles.totalsCol}>P · A · H</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((emp) => (
                      <tr key={emp._id}>
                        <th scope="row" className={styles.nameCol}>{emp.name}</th>
                        {monthDays.map((dateStr) => {
                          const dateObj = new Date(dateStr);
                          const isSunday = dateObj.getDay() === 0;
                          const joiningDate = new Date(emp.joiningDate).setHours(0, 0, 0, 0);
                          const selectedDate = new Date(dateStr).setHours(0, 0, 0, 0);
                          const isBeforeJoining = selectedDate < joiningDate;
                          const terminationDate = emp.terminationDate ? new Date(emp.terminationDate).setHours(0, 0, 0, 0) : null;
                          const isAfterTermination = terminationDate ? selectedDate > terminationDate : false;
                          const status = monthlyRecords[dateStr]?.[emp._id] || (isSunday ? 'holiday' : 'none');
                          const cell = CELL[status as DayStatus] ?? CELL.none;
                          const dayLabel = dateObj.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
                          return (
                            <td key={dateStr} className={cx(styles.cell, isSunday && styles.sunday)}>
                              {dateStr > todayStr ? null : isBeforeJoining ? (
                                <span className={styles.na} title="Before joining">–</span>
                              ) : isAfterTermination ? (
                                <span className={styles.terminated} title="Terminated">T</span>
                              ) : (
                                <button
                                  type="button"
                                  className={cx(styles.mark, cell.className)}
                                  title={`${dayLabel}: ${cell.label}`}
                                  aria-label={`${emp.name}, ${dayLabel}: ${cell.label}. Change`}
                                  onClick={() => markMonthlyAttendance(emp._id, dateStr, status)}
                                >
                                  {cell.letter}
                                </button>
                              )}
                            </td>
                          );
                        })}
                        <td className={styles.totalsCol}>{`${emp.stats.presentDays} · ${emp.stats.absentDays} · ${emp.stats.halfDays}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      )}

      {activeTab === 'salary' && (
        <Card title={`Salary · ${monthLabel}`} eyebrow="click a row for its computation" padding="sm">
          {loading && employees.length === 0 ? (
            <Skeleton lines={5} />
          ) : employees.length === 0 ? (
            noStaff
          ) : (
            <div className="pbx-table">
              <div className="pbx-table__scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Employee</th>
                      <th scope="col" className={styles.right}>Base salary</th>
                      <th scope="col">Attendance P · A · H</th>
                      <th scope="col" className={styles.right}>Deductions</th>
                      <th scope="col" className={styles.right}>Advances</th>
                      <th scope="col" className={styles.right}>Net due</th>
                      <th scope="col">Status</th>
                      <th scope="col"><span className="pbx-sr">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((emp) => (
                      <tr key={emp._id} className="is-clickable" onClick={() => setSalaryEmployee(emp)}>
                        <td className={styles.strong}>{emp.name}</td>
                        <td className={cx('pbx-num', styles.right)}>{formatINR(emp.monthlySalary)}</td>
                        <td className={styles.pah}>
                          <b className={styles.pCount}>{emp.stats.presentDays}</b> · <b className={styles.aCount}>{emp.stats.absentDays}</b> · <b className={styles.hCount}>{emp.stats.halfDays}</b>
                        </td>
                        <td className={cx('pbx-num', styles.right)}>{formatINR(-emp.stats.deductions)}</td>
                        <td className={cx('pbx-num', styles.right)}>{formatINR(-emp.stats.totalAdvances)}</td>
                        <td className={cx('pbx-num', styles.right, styles.strong)}>{formatINR(emp.stats.netSalary)}</td>
                        <td><Badge size="sm" tone={emp.stats.isPaid ? 'positive' : 'caution'}>{emp.stats.isPaid ? 'Paid' : 'Unpaid'}</Badge></td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {!emp.stats.isPaid && (
                            <div className={styles.actions}>
                              <Button size="sm" icon="plus" onClick={() => { setSelectedEmployee(emp._id); setShowAdvanceModal(true); }}>Add advance</Button>
                              <Button size="sm" icon="check" onClick={() => confirmMarkPaid(emp._id, emp.stats.netSalary, emp.name)}>Mark paid</Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      )}

      {activeTab === 'hourly' && (
        <>
          <Card title="Log hours" eyebrow="hourly workers">
            {hourlyEmployees.length === 0 ? (
              <EmptyState
                size="sm"
                icon="users"
                title="No hourly workers yet"
                description="Add one in Manage employees first."
                action={<Button size="sm" onClick={() => setActiveTab('employees')}>Manage employees</Button>}
              />
            ) : (
              <form onSubmit={handleLogHours} className={styles.logForm}>
                <Select
                  label="Employee"
                  required
                  value={logForm.employeeId}
                  onChange={(e) => setLogForm((f) => ({ ...f, employeeId: e.target.value }))}
                  options={[
                    { value: '', label: 'Select employee…' },
                    ...hourlyEmployees.map((emp) => ({ value: emp._id, label: `${emp.name} · ₹${emp.hourlyRate}/hr` })),
                  ]}
                />
                <TextField
                  label="Date"
                  type="date"
                  required
                  max={todayStr}
                  value={logForm.dateStr}
                  onChange={(e) => setLogForm((f) => ({ ...f, dateStr: e.target.value }))}
                />
                <TextField
                  label="Hours"
                  type="number"
                  required
                  min="0.5"
                  max="24"
                  step="0.5"
                  suffix="hrs"
                  placeholder="8"
                  value={logForm.hoursWorked}
                  onChange={(e) => setLogForm((f) => ({ ...f, hoursWorked: e.target.value }))}
                />
                <TextField
                  label="Notes"
                  placeholder="Overtime, special task…"
                  className={styles.notesField}
                  value={logForm.notes}
                  onChange={(e) => setLogForm((f) => ({ ...f, notes: e.target.value }))}
                />
                <Button type="submit" variant="primary" loading={submittingLog}>Log hours</Button>
              </form>
            )}
          </Card>

          {sortedHourlyMonths.length === 0 ? (
            hourlyEmployees.length > 0 && <EmptyState size="sm" icon="calendar" title="No hours logged yet" description="Log the first entry above." />
          ) : (
            sortedHourlyMonths.map((month) => {
              const label = new Date(month + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
              const empGroups = Object.values(hourlyMonths[month]);
              const monthHours = empGroups.reduce((t, g) => t + g.logs.reduce((s, l) => s + l.hoursWorked, 0), 0);
              return (
                <Card key={month} title={label} eyebrow={`${monthHours} h total`} padding="sm">
                  {empGroups.map(({ emp, logs }) => {
                    const totalHours = logs.reduce((s, l) => s + l.hoursWorked, 0);
                    const totalEarnings = Math.round(totalHours * emp.hourlyRate);
                    return (
                      <div key={emp._id} className={styles.group}>
                        <div className={styles.groupHead}>
                          <Avatar name={emp.name} size="sm" />
                          <span className={styles.strong}>{emp.name}</span>
                          <span className={styles.muted}>{`₹${emp.hourlyRate}/hr`}</span>
                          <span className="pbx-num">{`${totalHours} h`}</span>
                          <span className={cx('pbx-num', styles.strong)}>{formatINR(totalEarnings)}</span>
                          <span className={styles.groupEnd}>
                            {emp.isPaid ? (
                              <Badge size="sm" tone="positive">Paid</Badge>
                            ) : (
                              <Button size="sm" icon="check" onClick={() => confirmMarkPaid(emp._id, totalEarnings, emp.name)}>Mark paid</Button>
                            )}
                          </span>
                        </div>
                        <div className="pbx-table">
                          <div className="pbx-table__scroll">
                            <table>
                              <thead>
                                <tr>
                                  <th scope="col" style={{ width: 96 }}>Date</th>
                                  <th scope="col" style={{ width: 64 }}>Day</th>
                                  <th scope="col" className={styles.right} style={{ width: 72 }}>Hours</th>
                                  <th scope="col" className={styles.right} style={{ width: 96 }}>Earnings</th>
                                  <th scope="col" className={styles.notesCol}>Notes</th>
                                  <th scope="col" style={{ width: 40 }}><span className="pbx-sr">Actions</span></th>
                                </tr>
                              </thead>
                              <tbody>
                                {logs.sort((a, b) => a.dateStr.localeCompare(b.dateStr)).map((log) => (
                                  <tr key={log.dateStr}>
                                    <td className="pbx-mono">{new Date(log.dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</td>
                                    <td className={styles.muted}>{new Date(log.dateStr).toLocaleDateString('en-US', { weekday: 'short' })}</td>
                                    <td className={cx('pbx-num', styles.right)}>{`${log.hoursWorked} h`}</td>
                                    <td className={cx('pbx-num', styles.right)}>{formatINR(Math.round(log.hoursWorked * emp.hourlyRate))}</td>
                                    <td className={styles.muted}>{log.notes || '—'}</td>
                                    <td>
                                      <div className={styles.actions}>
                                        <Button size="sm" variant="ghost" iconOnly icon="trash-2" title="Delete entry" onClick={() => confirmDeleteLog(emp._id, log.dateStr)}>
                                          {`Delete the entry for ${log.dateStr}`}
                                        </Button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </Card>
              );
            })
          )}
        </>
      )}

      {activeTab === 'employees' && (
        <Card
          title="Employees"
          eyebrow={`${allEmployeesList.filter((e) => e.isActive).length} active · ${allEmployeesList.filter((e) => !e.isActive).length} inactive`}
          actions={<Button size="sm" variant="primary" icon="plus" onClick={() => setShowEmployeeModal(true)}>Add employee</Button>}
          padding="sm"
        >
          {allEmployeesList.length === 0 ? (
            <EmptyState size="sm" icon="users" title="No employees yet" description="Add your first employee to start the register." />
          ) : (
            <div className="pbx-table">
              <div className="pbx-table__scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Type</th>
                      <th scope="col" className={styles.right}>Salary or rate</th>
                      <th scope="col">Joined</th>
                      <th scope="col">Status</th>
                      <th scope="col">Termination</th>
                      <th scope="col"><span className="pbx-sr">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {allEmployeesList.map((emp) => (
                      <tr key={emp._id} className={emp.isActive ? undefined : styles.inactive}>
                        <td>
                          <span className={styles.person}>
                            <Avatar name={emp.name} size="sm" />
                            <span className={styles.strong}>{emp.name}</span>
                          </span>
                        </td>
                        <td><Badge size="sm" dot={false}>{emp.employeeType === 'hourly' ? 'Hourly' : 'Monthly'}</Badge></td>
                        <td className={cx('pbx-num', styles.right)}>
                          {emp.employeeType === 'hourly' ? `₹${emp.hourlyRate}/hr` : `${formatINR(emp.monthlySalary ?? 0)}/mo`}
                        </td>
                        <td className="pbx-mono">{new Date(emp.joiningDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                        <td><Badge size="sm" tone={emp.isActive ? 'positive' : 'neutral'}>{emp.isActive ? 'Active' : 'Inactive'}</Badge></td>
                        <td>
                          {!emp.isActive && emp.terminationDate ? (
                            <span className={styles.termination}>
                              <span className="pbx-mono">{new Date(emp.terminationDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                              {emp.isFnfMarked ? (
                                <Badge size="sm" tone="positive" dot={false} icon="check">{`FNF ${formatINR(emp.fnfAmount ?? 0)}`}</Badge>
                              ) : (
                                <Badge size="sm" tone="caution" dot={false} icon="triangle-alert">FNF pending</Badge>
                              )}
                            </span>
                          ) : (
                            <span className="pbx-amount--none">—</span>
                          )}
                        </td>
                        <td>
                          <div className={styles.actions}>
                            <Button
                              size="sm"
                              onClick={() => {
                                setStatusForm({
                                  employeeId: emp._id,
                                  name: emp.name,
                                  isActive: emp.isActive,
                                  terminationDate: emp.terminationDate ? new Date(emp.terminationDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
                                  isFnfMarked: emp.isFnfMarked || false,
                                  fnfAmount: emp.fnfAmount ? emp.fnfAmount.toString() : ''
                                });
                                setShowStatusModal(true);
                              }}
                            >
                              Manage status
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      )}

      <Drawer
        open={!!salaryEmployee}
        onClose={() => setSalaryEmployee(null)}
        title={salaryEmployee ? `${salaryEmployee.name} · salary` : 'Salary'}
        description={monthLabel}
        footer={salaryEmployee ? (
          <>
            <Badge size="sm" tone={salaryEmployee.stats.isPaid ? 'positive' : 'caution'}>{salaryEmployee.stats.isPaid ? 'Paid' : 'Unpaid'}</Badge>
            {!salaryEmployee.stats.isPaid && (
              <Button size="sm" variant="primary" icon="check" onClick={() => { const emp = salaryEmployee; setSalaryEmployee(null); confirmMarkPaid(emp._id, emp.stats.netSalary, emp.name); }}>
                Mark paid
              </Button>
            )}
          </>
        ) : undefined}
      >
        {salaryEmployee && (
          <div className={styles.drawerBody}>
            <DataList
              title="Attendance"
              items={[
                { label: 'Present', value: salaryEmployee.stats.presentDays },
                { label: 'Absent', value: salaryEmployee.stats.absentDays },
                { label: 'Half days', value: salaryEmployee.stats.halfDays },
              ]}
            />
            <DataList
              title="Computation"
              items={[
                { label: 'Base salary', value: formatINR(salaryEmployee.monthlySalary) },
                ...(salaryEmployee.stats.proratedBaseSalary !== undefined && salaryEmployee.stats.proratedBaseSalary !== salaryEmployee.monthlySalary
                  ? [{ label: 'Prorated', sub: 'joined during the month', value: formatINR(salaryEmployee.stats.proratedBaseSalary) }]
                  : []),
                { label: 'Absences and half days', value: formatINR(-salaryEmployee.stats.deductions) },
                { label: 'Advances', value: formatINR(-salaryEmployee.stats.totalAdvances) },
              ]}
              total={{ label: 'Net due', value: formatINR(salaryEmployee.stats.netSalary) }}
            />
          </div>
        )}
      </Drawer>

      <Dialog
        open={showEmployeeModal}
        onClose={() => setShowEmployeeModal(false)}
        title="Add employee"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowEmployeeModal(false)}>Cancel</Button>
            <Button variant="primary" type="submit" form="employee-form">Save employee</Button>
          </>
        }
      >
        <form id="employee-form" onSubmit={handleAddEmployee} className={styles.form}>
          <TextField label="Full name" required value={empForm.name} onChange={(e) => setEmpForm({ ...empForm, name: e.target.value })} />
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Employee type</span>
            <SegmentedControl
              label="Employee type"
              value={empForm.employeeType}
              onChange={(v) => setEmpForm({ ...empForm, employeeType: v as 'monthly' | 'hourly' })}
              options={[{ value: 'monthly', label: 'Monthly' }, { value: 'hourly', label: 'Hourly' }]}
            />
          </div>
          {empForm.employeeType === 'monthly' ? (
            <TextField label="Monthly salary" type="number" min="0" required prefix="₹" value={empForm.monthlySalary} onChange={(e) => setEmpForm({ ...empForm, monthlySalary: e.target.value })} />
          ) : (
            <TextField label="Hourly rate" type="number" min="0" step="0.5" required prefix="₹" suffix="/hr" value={empForm.hourlyRate} onChange={(e) => setEmpForm({ ...empForm, hourlyRate: e.target.value })} />
          )}
          <TextField label="Joining date" type="date" required value={empForm.joiningDate} onChange={(e) => setEmpForm({ ...empForm, joiningDate: e.target.value })} />
        </form>
      </Dialog>

      <Dialog
        open={showAdvanceModal}
        onClose={() => setShowAdvanceModal(false)}
        size="sm"
        title="Record salary advance"
        description={employees.find((e) => e._id === selectedEmployee)?.name}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowAdvanceModal(false)}>Cancel</Button>
            <Button variant="primary" type="submit" form="advance-form">Save advance</Button>
          </>
        }
      >
        <form id="advance-form" onSubmit={handleAddAdvance} className={styles.form}>
          <TextField label="Amount" type="number" min="1" required prefix="₹" value={advForm.amount} onChange={(e) => setAdvForm({ ...advForm, amount: e.target.value })} />
          <TextField label="Reason or notes" value={advForm.reason} onChange={(e) => setAdvForm({ ...advForm, reason: e.target.value })} />
        </form>
      </Dialog>

      <Dialog
        open={showStatusModal}
        onClose={() => setShowStatusModal(false)}
        title={`Manage status · ${statusForm.name}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowStatusModal(false)}>Cancel</Button>
            <Button variant="primary" type="submit" form="status-form">Save status</Button>
          </>
        }
      >
        <form id="status-form" onSubmit={handleStatusSubmit} className={styles.form}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Employment status</span>
            <SegmentedControl
              label="Employment status"
              value={statusForm.isActive ? 'active' : 'inactive'}
              onChange={(v) => setStatusForm({ ...statusForm, isActive: v === 'active' })}
              options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Terminated or inactive' }]}
            />
          </div>
          {!statusForm.isActive && (
            <>
              <TextField label="Termination date" type="date" required value={statusForm.terminationDate} onChange={(e) => setStatusForm({ ...statusForm, terminationDate: e.target.value })} />
              <Checkbox label="Full and final settled" checked={statusForm.isFnfMarked} onChange={(e) => setStatusForm({ ...statusForm, isFnfMarked: e.target.checked })} />
              {statusForm.isFnfMarked && (
                <TextField label="FNF amount" type="number" required prefix="₹" value={statusForm.fnfAmount} onChange={(e) => setStatusForm({ ...statusForm, fnfAmount: e.target.value })} />
              )}
            </>
          )}
        </form>
      </Dialog>

      <Dialog
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        size="sm"
        title={confirmAction?.title ?? ''}
        description={confirmAction?.description}
        icon={confirmAction?.danger ? 'triangle-alert' : undefined}
        tone={confirmAction?.danger ? 'negative' : 'neutral'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmAction(null)}>Cancel</Button>
            <Button
              variant={confirmAction?.danger ? 'danger' : 'primary'}
              onClick={() => {
                const run = confirmAction?.run;
                setConfirmAction(null);
                run?.();
              }}
            >
              {confirmAction?.confirmLabel}
            </Button>
          </>
        }
      />
    </div>
  );
}
