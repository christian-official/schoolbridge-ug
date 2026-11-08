import { useState } from 'react'
import AttendanceManagement from './AttendanceManagement'
import OperationsManagement from './OperationsManagement'

export default function AttendanceHub({ token, canViewStudents = true, canViewStaff = true, canEditStudents = true, permissions = {}, isAdmin = false, roleLabel = '' }: { token: string; canViewStudents?: boolean; canViewStaff?: boolean; canEditStudents?: boolean; permissions?: Record<string,string[]>; isAdmin?: boolean; roleLabel?: string }) {
  const [section, setSection] = useState<'students' | 'staff'>(canViewStudents ? 'students' : 'staff')
  const showBoth = canViewStudents && canViewStaff
  return <div className="academic-workspace">
    <section className="panel">
      <div className="panel-heading"><div><h2>Attendance</h2><p>Student and staff attendance registers in one workspace.</p></div></div>
      {showBoth && <div className="student-class-tabs" role="tablist" aria-label="Attendance register">
        <button type="button" role="tab" aria-selected={section === 'students'} className={section === 'students' ? 'student-class-tab active' : 'student-class-tab'} onClick={() => setSection('students')}>Student Attendance</button>
        <button type="button" role="tab" aria-selected={section === 'staff'} className={section === 'staff' ? 'student-class-tab active' : 'student-class-tab'} onClick={() => setSection('staff')}>Staff Attendance</button>
      </div>}
    </section>
    {section === 'students' && canViewStudents ? <AttendanceManagement token={token} canEdit={canEditStudents} /> : canViewStaff ? <OperationsManagement token={token} active="Staff Attendance" permissions={permissions} isAdmin={isAdmin} roleLabel={roleLabel} /> : null}
  </div>
}
