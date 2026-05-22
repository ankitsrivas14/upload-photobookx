import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { api } from '../services/api';
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


export function AttendancePage() {
  const [activeTab, setActiveTab] = useState<'attendance' | 'salary' | 'employees' | 'hourly'>('attendance');
  const [monthStr, setMonthStr] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  
  // Monthly Attendance Grid State
  const [monthlyRecords, setMonthlyRecords] = useState<Record<string, Record<string, string>>>({});

  // Monthly Employees & Stats
  const [employees, setEmployees] = useState<EmployeeStat[]>([]);
  const [, setLoading] = useState(false);

  // Hourly Employees State
  const [hourlyEmployees, setHourlyEmployees] = useState<any[]>([]);
  const [allHourlyLogs, setAllHourlyLogs] = useState<any[]>([]);
  const [logForm, setLogForm] = useState({ employeeId: '', dateStr: new Date().toISOString().split('T')[0], hoursWorked: '', notes: '' });
  const [submittingLog, setSubmittingLog] = useState(false);

  // Modals
  const [showEmployeeModal, setShowEmployeeModal] = useState(false);
  const [showAdvanceModal, setShowAdvanceModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<string>('');
  const [allEmployeesList, setAllEmployeesList] = useState<any[]>([]);

  // Form states
  const [empForm, setEmpForm] = useState({ name: '', employeeType: 'monthly' as 'monthly' | 'hourly', monthlySalary: '', hourlyRate: '', joiningDate: '' });
  const [advForm, setAdvForm] = useState({ amount: '', reason: '' });
  const [statusForm, setStatusForm] = useState({ employeeId: '', name: '', isActive: true, terminationDate: '', isFnfMarked: false, fnfAmount: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getEmployeesStats(monthStr);
      if (res.success && res.employees) {
        setEmployees(res.employees);
      }
    } catch (error) {
      toast.error('Failed to load employee stats');
    } finally {
      setLoading(false);
    }
  }, [monthStr]);

  const loadAllEmployees = useCallback(async () => {
    try {
      const res = await api.getAllEmployees();
      if (res.success && res.employees) {
        setAllEmployeesList(res.employees);
      }
    } catch (error) {
      toast.error('Failed to load all employees');
    }
  }, []);

  const loadHourlyData = useCallback(async () => {
    try {
      const res = await api.getAllHourlyLogs();
      if (res.success) {
        setHourlyEmployees(res.employees || []);
        setAllHourlyLogs(res.logs || []);
      }
    } catch (error) {
      toast.error('Failed to load hourly logs');
    }
  }, []);

  const loadMonthlyData = useCallback(async () => {
    try {
      const res = await api.getMonthlyAttendance(monthStr);
      if (res.success && res.records) {
        const map: Record<string, Record<string, string>> = {};
        res.records.forEach((r: any) => {
          if (!map[r.dateStr]) map[r.dateStr] = {};
          map[r.dateStr][r.employeeId] = r.status;
        });
        setMonthlyRecords(map);
      }
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
      toast.error('Failed to log hours');
    } finally {
      setSubmittingLog(false);
    }
  };

  const handleDeleteLog = async (empId: string, dateStr: string) => {
    if (!window.confirm('Delete this log entry?')) return;
    try {
      await api.deleteHourlyLog(empId, dateStr);
      toast.success('Log deleted');
      loadHourlyData();
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
      toast.error('Failed to update employee status');
    }
  };

  const handleMarkPaid = async (empId: string, amount: number) => {
    if (!window.confirm('Mark this salary as paid?')) return;
    try {
      await api.markSalaryPaid(empId, monthStr, amount);
      toast.success('Salary marked as paid');
      loadData();
    } catch (error: any) {
      toast.error(error.message || 'Failed to mark as paid');
    }
  };

  const getDaysInMonth = (monthStr: string) => {
    const [year, month] = monthStr.split('-').map(Number);
    return new Date(year, month, 0).getDate();
  };

  const daysCount = getDaysInMonth(monthStr);
  const todayStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
  
  const dates = Array.from({ length: daysCount }, (_, i) => {
    const day = String(i + 1).padStart(2, '0');
    return `${monthStr}-${day}`;
  }).filter(dateStr => dateStr <= todayStr);

  const weeks: string[][] = [];
  let currentWeek: string[] = [];

  dates.forEach(dateStr => {
    const dateObj = new Date(dateStr);
    currentWeek.push(dateStr);
    
    // If it's Sunday (0), week ends
    if (dateObj.getDay() === 0) {
      weeks.push([...currentWeek]);
      currentWeek = [];
    }
  });
  
  if (currentWeek.length > 0) {
    weeks.push(currentWeek);
  }

  const getStatusLabel = (status: string) => {
    if (status === 'present') return 'P';
    if (status === 'half-day') return 'H';
    if (status === 'absent') return 'A';
    if (status === 'holiday') return 'Sun';
    return '-';
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>Staff & Attendance</h1>
        <div className={styles.headerActions}>
          <input 
            type="month" 
            className={styles.monthSelector}
            value={monthStr}
            onChange={e => setMonthStr(e.target.value)}
          />
        </div>
      </header>

      <div className={styles.tabs}>
        <button 
          className={`${styles.tab} ${activeTab === 'attendance' ? styles.active : ''}`}
          onClick={() => setActiveTab('attendance')}
        >Monthly Attendance Register</button>
        <button 
          className={`${styles.tab} ${activeTab === 'hourly' ? styles.active : ''}`}
          onClick={() => setActiveTab('hourly')}
        >Hourly Workers</button>
        <button 
          className={`${styles.tab} ${activeTab === 'salary' ? styles.active : ''}`}
          onClick={() => setActiveTab('salary')}
        >Salary & Advances</button>
        <button 
          className={`${styles.tab} ${activeTab === 'employees' ? styles.active : ''}`}
          onClick={() => setActiveTab('employees')}
        >Manage Employees</button>
      </div>

      {activeTab === 'attendance' && (
        <div className={styles.weeksContainer}>
          {weeks.map((weekDates, weekIndex) => (
            <div key={weekIndex} className={styles.card} style={{ overflowX: 'auto', padding: '1rem', marginBottom: '2rem' }}>
              <h3 style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: '1rem', marginTop: 0 }}>
                Week {weekIndex + 1}
              </h3>
              <table className={styles.registerTable}>
                <thead>
                  <tr>
                    <th className={styles.stickyCol}>Date</th>
                    {employees.map(emp => (
                      <th key={emp._id}>{emp.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weekDates.map(dateStr => {
                    const dateObj = new Date(dateStr);
                    const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
                    const isSunday = dateObj.getDay() === 0;
                    
                    return (
                      <tr key={dateStr} className={isSunday ? styles.sundayRow : ''}>
                        <td className={styles.stickyCol}>
                          <div className={styles.dateInfo}>
                            <span className={styles.dateNum}>{dateStr.split('-')[2]}</span>
                            <span className={styles.dayName}>{dayName}</span>
                          </div>
                        </td>
                        {employees.map(emp => {
                          const joiningDate = new Date(emp.joiningDate).setHours(0,0,0,0);
                          const selectedDate = new Date(dateStr).setHours(0,0,0,0);
                          const isBeforeJoining = selectedDate < joiningDate;
                          
                          const terminationDate = emp.terminationDate ? new Date(emp.terminationDate).setHours(0,0,0,0) : null;
                          const isAfterTermination = terminationDate ? selectedDate > terminationDate : false;
                          
                          const status = monthlyRecords[dateStr]?.[emp._id] || (isSunday ? 'holiday' : 'none');
                          
                          return (
                            <td key={emp._id} className={styles.statusCell}>
                              {isBeforeJoining ? (
                                <span className={styles.notJoined}>-</span>
                              ) : isAfterTermination ? (
                                <span className={styles.notJoined} style={{ color: '#ef4444', fontWeight: 'bold' }} title="Terminated">T</span>
                              ) : (
                                <button 
                                  className={`${styles.gridStatusBtn} ${styles[status]}`}
                                  onClick={() => markMonthlyAttendance(emp._id, dateStr, status)}
                                >
                                  {getStatusLabel(status)}
                                </button>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}

          {weeks.length === 0 && (
            <div className={styles.card} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
              No dates available for this month yet.
            </div>
          )}

          <div className={styles.legend}>
            <span><strong>P</strong>: Present</span>
            <span><strong>H</strong>: Half Day</span>
            <span><strong>A</strong>: Absent</span>
            <span><strong>Sun</strong>: Sunday/Holiday</span>
            <span><strong style={{ color: '#ef4444' }}>T</strong>: Terminated</span>
          </div>
        </div>
      )}

      {activeTab === 'salary' && (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h2>Salary Computation ({monthStr})</h2>
          </div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Base Salary</th>
                <th>Attendance (P/A/H)</th>
                <th>Deductions</th>
                <th>Advances</th>
                <th>Net Due</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => (
                <tr key={emp._id}>
                  <td>{emp.name}</td>
                  <td>₹{emp.monthlySalary.toLocaleString()}</td>
                  <td>
                    <span className={styles.presentCount}>{emp.stats.presentDays}</span> /{' '}
                    <span className={styles.absentCount}>{emp.stats.absentDays}</span> /{' '}
                    <span className={styles.halfCount}>{emp.stats.halfDays}</span>
                  </td>
                  <td className={styles.deductionAmount}>-₹{emp.stats.deductions.toLocaleString()}</td>
                  <td className={styles.advanceAmount}>-₹{emp.stats.totalAdvances.toLocaleString()}</td>
                  <td className={styles.netDueAmount}>
                    ₹{emp.stats.netSalary.toLocaleString()}
                    {emp.monthlySalary !== emp.stats.netSalary && (
                      <div className={styles.infoIconWrapper}>
                        <span className={styles.infoIcon}>i</span>
                        <div className={styles.tooltip}>
                          <div className={styles.tooltipRow}>
                            <span>Base Salary:</span>
                            <span>₹{emp.monthlySalary.toLocaleString()}</span>
                          </div>
                          {emp.stats.proratedBaseSalary !== emp.monthlySalary && (
                            <div className={styles.tooltipRow}>
                              <span>Prorated (Joined late):</span>
                              <span>₹{emp.stats.proratedBaseSalary?.toLocaleString()}</span>
                            </div>
                          )}
                          {emp.stats.deductions > 0 && (
                            <div className={styles.tooltipRow} style={{ color: '#fca5a5' }}>
                              <span>Absences/Half-days:</span>
                              <span>-₹{emp.stats.deductions.toLocaleString()}</span>
                            </div>
                          )}
                          {emp.stats.totalAdvances > 0 && (
                            <div className={styles.tooltipRow} style={{ color: '#fca5a5' }}>
                              <span>Advances:</span>
                              <span>-₹{emp.stats.totalAdvances.toLocaleString()}</span>
                            </div>
                          )}
                          <div className={`${styles.tooltipRow} ${styles.total}`}>
                            <span>Net Due:</span>
                            <span>₹{emp.stats.netSalary.toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </td>
                  <td>
                    {emp.stats.isPaid ? (
                      <span className={`${styles.badge} ${styles.paid}`}>Paid</span>
                    ) : (
                      <span className={`${styles.badge} ${styles.unpaid}`}>Unpaid</span>
                    )}
                  </td>
                  <td>
                    {!emp.stats.isPaid && (
                      <>
                        <button className={styles.actionBtn} onClick={() => {
                          setSelectedEmployee(emp._id);
                          setShowAdvanceModal(true);
                        }}>Add Advance</button>
                        <button className={`${styles.actionBtn} ${styles.pay}`} onClick={() => handleMarkPaid(emp._id, emp.stats.netSalary)}>
                          Mark Paid
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'hourly' && (
        <div>
          {/* Log Entry Form */}
          <div className={styles.card} style={{ marginBottom: '1.5rem' }}>
            <div className={styles.cardHeader}>
              <h2>Log Work Hours</h2>
            </div>
            {hourlyEmployees.length === 0 ? (
              <p style={{ color: '#64748b', fontSize: '0.875rem', padding: '0.5rem 0' }}>
                No hourly employees found. Add one from the "Manage Employees" tab first.
              </p>
            ) : (
              <form onSubmit={handleLogHours} className={styles.logForm}>
                <div className={styles.logFormRow}>
                  <div className={styles.logFormField}>
                    <label>Employee</label>
                    <select
                      required
                      value={logForm.employeeId}
                      onChange={e => setLogForm(f => ({ ...f, employeeId: e.target.value }))}
                    >
                      <option value="">Select employee...</option>
                      {hourlyEmployees.map((emp: any) => (
                        <option key={emp._id} value={emp._id}>
                          {emp.name} (₹{emp.hourlyRate}/hr)
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.logFormField}>
                    <label>Date</label>
                    <input
                      type="date"
                      required
                      max={todayStr}
                      value={logForm.dateStr}
                      onChange={e => setLogForm(f => ({ ...f, dateStr: e.target.value }))}
                    />
                  </div>
                  <div className={styles.logFormField}>
                    <label>Hours Worked</label>
                    <input
                      type="number"
                      required
                      min="0.5"
                      max="24"
                      step="0.5"
                      placeholder="e.g. 8"
                      value={logForm.hoursWorked}
                      onChange={e => setLogForm(f => ({ ...f, hoursWorked: e.target.value }))}
                    />
                  </div>
                  <div className={styles.logFormField} style={{ flex: 2 }}>
                    <label>Notes (optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. Overtime, special task..."
                      value={logForm.notes}
                      onChange={e => setLogForm(f => ({ ...f, notes: e.target.value }))}
                    />
                  </div>
                  <div className={styles.logFormField} style={{ flex: 'none', justifyContent: 'flex-end' }}>
                    <label style={{ opacity: 0 }}>Submit</label>
                    <button type="submit" className={styles.btnPrimary} disabled={submittingLog}>
                      {submittingLog ? 'Saving...' : 'Log Hours'}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>

          {/* Records Tables — grouped by Month then Employee */}
          {(() => {
            // Build: { 'YYYY-MM': { empId: { emp, logs[] } } }
            const months: Record<string, Record<string, { emp: any; logs: any[] }>> = {};
            allHourlyLogs.forEach((log: any) => {
              const month = log.dateStr.substring(0, 7);
              const emp = hourlyEmployees.find((e: any) => e._id === log.employeeId.toString() || e._id.toString() === log.employeeId.toString());
              if (!emp) return;
              if (!months[month]) months[month] = {};
              if (!months[month][emp._id]) months[month][emp._id] = { emp, logs: [] };
              months[month][emp._id].logs.push(log);
            });

            const sortedMonths = Object.keys(months).sort((a, b) => b.localeCompare(a));

            if (sortedMonths.length === 0) {
              return (
                <div className={styles.card} style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                  No hours logged yet. Use the form above to add your first entry.
                </div>
              );
            }

            return sortedMonths.map(month => {
              const monthLabel = new Date(month + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
              const empGroups = Object.values(months[month]);

              return (
                <div key={month} className={styles.card} style={{ marginBottom: '1.5rem' }}>
                  <div className={styles.cardHeader}>
                    <h2 style={{ fontSize: '1rem' }}>{monthLabel}</h2>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      {empGroups.reduce((t, g) => t + g.logs.reduce((s, l) => s + l.hoursWorked, 0), 0)}h total
                    </div>
                  </div>

                  {empGroups.map(({ emp, logs }) => {
                    const totalHours = logs.reduce((s, l) => s + l.hoursWorked, 0);
                    const totalEarnings = Math.round(totalHours * emp.hourlyRate);

                    return (
                      <div key={emp._id} style={{ marginBottom: '1.5rem' }}>
                        <div className={styles.hourlyEmpHeader}>
                          <span className={styles.hourlyEmpName}>{emp.name}</span>
                          <span className={styles.hourlyEmpRate}>₹{emp.hourlyRate}/hr</span>
                          <span className={styles.hoursTotal}>{totalHours}h</span>
                          <span className={styles.earningsTotal}>₹{totalEarnings.toLocaleString()}</span>
                          {!emp.isPaid && (
                            <button
                              className={`${styles.actionBtn} ${styles.pay}`}
                              style={{ marginLeft: 'auto' }}
                              onClick={() => handleMarkPaid(emp._id, totalEarnings)}
                            >
                              Mark Paid
                            </button>
                          )}
                          {emp.isPaid && <span className={`${styles.badge} ${styles.paid}`} style={{ marginLeft: 'auto' }}>Paid</span>}
                        </div>

                        <table className={styles.table} style={{ marginTop: '0.5rem' }}>
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Day</th>
                              <th>Hours</th>
                              <th>Earnings</th>
                              <th>Notes</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {logs.sort((a, b) => a.dateStr.localeCompare(b.dateStr)).map(log => (
                              <tr key={log.dateStr}>
                                <td>{new Date(log.dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</td>
                                <td style={{ color: '#64748b' }}>{new Date(log.dateStr).toLocaleDateString('en-US', { weekday: 'short' })}</td>
                                <td><span className={styles.hoursBadge}>{log.hoursWorked}h</span></td>
                                <td style={{ color: '#16a34a', fontWeight: 600 }}>₹{Math.round(log.hoursWorked * emp.hourlyRate).toLocaleString()}</td>
                                <td style={{ color: '#64748b', fontSize: '0.8125rem' }}>{log.notes || '—'}</td>
                                <td>
                                  <button
                                    className={styles.deleteBtn}
                                    onClick={() => handleDeleteLog(emp._id, log.dateStr)}
                                    title="Delete entry"
                                  >✕</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })}
                </div>
              );
            });
          })()}
        </div>
      )}

      {activeTab === 'employees' && (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <h2>Manage Employees</h2>
            <button className={styles.btnPrimary} onClick={() => setShowEmployeeModal(true)}>
              + Add Employee
            </button>
          </div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Salary / Rate</th>
                <th>Joining Date</th>
                <th>Status</th>
                <th>Termination Info</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {allEmployeesList.map(emp => (
                <tr key={emp._id} style={{ opacity: emp.isActive ? 1 : 0.6 }}>
                  <td>{emp.name}</td>
                  <td style={{ textTransform: 'capitalize' }}>{emp.employeeType}</td>
                  <td>
                    {emp.employeeType === 'hourly' 
                      ? `₹${emp.hourlyRate}/hr` 
                      : `₹${emp.monthlySalary.toLocaleString()}/mo`}
                  </td>
                  <td>{new Date(emp.joiningDate).toLocaleDateString()}</td>
                  <td>
                    <span className={`${styles.badge} ${emp.isActive ? styles.paid : styles.unpaid}`}>
                      {emp.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    {!emp.isActive && emp.terminationDate ? (
                      <div style={{ fontSize: '0.85rem' }}>
                        <div>Term: {new Date(emp.terminationDate).toLocaleDateString()}</div>
                        <div style={{ color: emp.isFnfMarked ? '#16a34a' : '#ef4444' }}>
                          {emp.isFnfMarked ? `✓ FNF (₹${emp.fnfAmount?.toLocaleString() || 0})` : '⚠ FNF Pending'}
                        </div>
                      </div>
                    ) : (
                      <span style={{ color: '#94a3b8' }}>-</span>
                    )}
                  </td>
                  <td>
                    <button 
                      className={styles.actionBtn}
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
                      Manage Status
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Employee Modal */}
      {showEmployeeModal && (
        <div className={styles.modalOverlay} onClick={() => setShowEmployeeModal(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h3>Add New Employee</h3>
            <form onSubmit={handleAddEmployee}>
              <div className={styles.formGroup}>
                <label>Full Name</label>
                <input required type="text" value={empForm.name} onChange={e => setEmpForm({...empForm, name: e.target.value})} />
              </div>
              <div className={styles.formGroup}>
                <label>Employee Type</label>
                <div className={styles.typeToggle}>
                  <button type="button"
                    className={empForm.employeeType === 'monthly' ? styles.typeActive : styles.typeInactive}
                    onClick={() => setEmpForm({...empForm, employeeType: 'monthly'})}>
                    Monthly
                  </button>
                  <button type="button"
                    className={empForm.employeeType === 'hourly' ? styles.typeActive : styles.typeInactive}
                    onClick={() => setEmpForm({...empForm, employeeType: 'hourly'})}>
                    Hourly
                  </button>
                </div>
              </div>
              {empForm.employeeType === 'monthly' ? (
                <div className={styles.formGroup}>
                  <label>Monthly Salary (₹)</label>
                  <input required type="number" min="0" value={empForm.monthlySalary} onChange={e => setEmpForm({...empForm, monthlySalary: e.target.value})} />
                </div>
              ) : (
                <div className={styles.formGroup}>
                  <label>Hourly Rate (₹/hr)</label>
                  <input required type="number" min="0" step="0.5" value={empForm.hourlyRate} onChange={e => setEmpForm({...empForm, hourlyRate: e.target.value})} />
                </div>
              )}
              <div className={styles.formGroup}>
                <label>Joining Date</label>
                <input required type="date" value={empForm.joiningDate} onChange={e => setEmpForm({...empForm, joiningDate: e.target.value})} />
              </div>
              <div className={styles.modalActions}>
                <button type="button" className={styles.btnSecondary} onClick={() => setShowEmployeeModal(false)}>Cancel</button>
                <button type="submit" className={styles.btnPrimary}>Save Employee</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Advance Modal */}
      {showAdvanceModal && (
        <div className={styles.modalOverlay} onClick={() => setShowAdvanceModal(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h3>Record Salary Advance</h3>
            <form onSubmit={handleAddAdvance}>
              <div className={styles.formGroup}>
                <label>Amount (₹)</label>
                <input required type="number" min="1" value={advForm.amount} onChange={e => setAdvForm({...advForm, amount: e.target.value})} />
              </div>
              <div className={styles.formGroup}>
                <label>Reason / Notes</label>
                <input type="text" value={advForm.reason} onChange={e => setAdvForm({...advForm, reason: e.target.value})} />
              </div>
              <div className={styles.modalActions}>
                <button type="button" className={styles.btnSecondary} onClick={() => setShowAdvanceModal(false)}>Cancel</button>
                <button type="submit" className={styles.btnPrimary}>Save Advance</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manage Status Modal */}
      {showStatusModal && (
        <div className={styles.modalOverlay} onClick={() => setShowStatusModal(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h3>Manage Status: {statusForm.name}</h3>
            <form onSubmit={handleStatusSubmit}>
              <div className={styles.formGroup}>
                <label>Employment Status</label>
                <div className={styles.typeToggle}>
                  <button type="button"
                    className={statusForm.isActive ? styles.typeActive : styles.typeInactive}
                    onClick={() => setStatusForm({...statusForm, isActive: true})}>
                    Active
                  </button>
                  <button type="button"
                    className={!statusForm.isActive ? styles.typeActive : styles.typeInactive}
                    onClick={() => setStatusForm({...statusForm, isActive: false})}>
                    Terminated / Inactive
                  </button>
                </div>
              </div>
              
              {!statusForm.isActive && (
                <>
                  <div className={styles.formGroup}>
                    <label>Termination Date</label>
                    <input 
                      required 
                      type="date" 
                      value={statusForm.terminationDate} 
                      onChange={e => setStatusForm({...statusForm, terminationDate: e.target.value})} 
                    />
                  </div>
                  <div className={styles.formGroup} style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
                    <input 
                      type="checkbox" 
                      id="fnfCheck"
                      checked={statusForm.isFnfMarked} 
                      onChange={e => setStatusForm({...statusForm, isFnfMarked: e.target.checked})}
                      style={{ width: 'auto' }}
                    />
                    <label htmlFor="fnfCheck" style={{ marginBottom: 0, cursor: 'pointer' }}>Mark Full & Final (FNF) Settled</label>
                  </div>
                  {statusForm.isFnfMarked && (
                    <div className={styles.formGroup}>
                      <label>FNF Amount (₹)</label>
                      <input 
                        required 
                        type="number" 
                        value={statusForm.fnfAmount} 
                        onChange={e => setStatusForm({...statusForm, fnfAmount: e.target.value})} 
                      />
                    </div>
                  )}
                </>
              )}
              
              <div className={styles.modalActions} style={{ marginTop: '1.5rem' }}>
                <button type="button" className={styles.btnSecondary} onClick={() => setShowStatusModal(false)}>Cancel</button>
                <button type="submit" className={styles.btnPrimary}>Save Status</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
