import { useState } from 'react'
import AttendanceManagement from './AttendanceManagement'
import OperationsManagement from './OperationsManagement'

export default function AttendanceHub({ token }: { token: string }) {
  const [section, setSection] = useState<'students' | 'staff'>('students')
  return <div className="academic-workspace">
    <section className="panel">
      <div className="panel-heading"><div><h2>Attendance</h2><p>Student and staff attendance registers in one workspace.</p></div></div>
      <div className="student-class-tabs" role="tablist" aria-label="Attendance register">
        <button type="button" role="tab" aria-selected={section === 'students'} className={section === 'students' ? 'student-class-tab active' : 'student-class-tab'} onClick={() => setSection('students')}>Student Attendance</button>
        <button type="button" role="tab" aria-selected={section === 'staff'} className={section === 'staff' ? 'student-class-tab active' : 'student-class-tab'} onClick={() => setSection('staff')}>Staff Attendance</button>
      </div>
    </section>
    {section === 'students' ? <AttendanceManagement token={token} /> : <OperationsManagement token={token} active="Staff Attendance" />}
  </div>
}
