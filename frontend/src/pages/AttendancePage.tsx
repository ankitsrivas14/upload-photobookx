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
  const [activeTab, setActiveTab] = useState<'attendance' | 'salary' | 'employees'>('attendance');
  const [monthStr, setMonthStr] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  
  // Monthly Attendance Grid State
  const [monthlyRecords, setMonthlyRecords] = useState<Record<string, Record<string, string>>>({});

  // Employees & Stats
  const [employees, setEmployees] = useState<EmployeeStat[]>([]);
  const [, setLoading] = useState(false);

  // Modals
  const [showEmployeeModal, setShowEmployeeModal] = useState(false);
  const [showAdvanceModal, setShowAdvanceModal] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<string>('');

  // Form states
  const [empForm, setEmpForm] = useState({ name: '', monthlySalary: '', joiningDate: '' });
  const [advForm, setAdvForm] = useState({ amount: '', reason: '' });

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
    if (activeTab === 'attendance') {
      loadMonthlyData();
    }
  }, [loadData, loadMonthlyData, activeTab]);

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
      await api.addEmployee(empForm.name, Number(empForm.monthlySalary), empForm.joiningDate);
      toast.success('Employee added');
      setShowEmployeeModal(false);
      setEmpForm({ name: '', monthlySalary: '', joiningDate: '' });
      loadData();
    } catch (error) {
      toast.error('Failed to add employee');
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
                          const status = monthlyRecords[dateStr]?.[emp._id] || (isSunday ? 'holiday' : 'none');
                          
                          return (
                            <td key={emp._id} className={styles.statusCell}>
                              {!isBeforeJoining ? (
                                <button 
                                  className={`${styles.gridStatusBtn} ${styles[status]}`}
                                  onClick={() => markMonthlyAttendance(emp._id, dateStr, status)}
                                >
                                  {getStatusLabel(status)}
                                </button>
                              ) : (
                                <span className={styles.notJoined}>-</span>
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
                <th>Monthly Salary</th>
                <th>Joining Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => (
                <tr key={emp._id}>
                  <td>{emp.name}</td>
                  <td>₹{emp.monthlySalary.toLocaleString()}</td>
                  <td>{new Date(emp.joiningDate).toLocaleDateString()}</td>
                  <td>{emp.isActive ? 'Active' : 'Inactive'}</td>
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
                <label>Monthly Salary (₹)</label>
                <input required type="number" min="0" value={empForm.monthlySalary} onChange={e => setEmpForm({...empForm, monthlySalary: e.target.value})} />
              </div>
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

    </div>
  );
}
