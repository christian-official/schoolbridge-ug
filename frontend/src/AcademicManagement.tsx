import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { BookOpen, Plus, RefreshCw, Save, Printer } from 'lucide-react'

type SchoolClass = { id: number; name?: string; section?: string }
type Subject = { id: number; name: string }
type Student = { id: number; first_name: string; middle_name?: string | null; last_name: string; admission_number: string; class_id?: number | null }
type Exam = { id: number; name: string; term: string; year: number; class_id: number | null }
type Mark = { id: number; student_id: number; subject_id: number; exam_id: number; score: number; verified: boolean }
type GradeBand = { id?: number; grade: string; min_score: number; max_score: number; remark: string }
type SchoolProfile = { name?: string; address?: string | null; phone?: string | null; email?: string | null; motto?: string | null }
type Page<T> = { items: T[]; total: number; pages?: number }

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

async function request<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/api/${path}`, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + token,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${data.detail || 'Request failed'} (HTTP ${response.status})`)
  return data as T
}

function studentName(student?: Student) {
  return student ? [student.first_name, student.middle_name, student.last_name].filter(Boolean).join(' ') : 'Unknown student'
}

async function fetchClassStudents(token: string, classId: number | null): Promise<Student[]> {
  const query = classId === null ? '' : `&class_id=${classId}`
  const first = await request<Page<Student>>(`students/search?page=1&page_size=100${query}`, token)
  const remaining = await Promise.all(
    Array.from({ length: Math.max(0, (first.pages || 1) - 1) }, (_, index) =>
      request<Page<Student>>(`students/search?page=${index + 2}&page_size=100${query}`, token)
    )
  )
  return [first, ...remaining].flatMap(page => page.items)
}

export default function AcademicManagement({ token, classes }: { token: string; classes: SchoolClass[] }) {
  const [exams, setExams] = useState<Exam[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [marks, setMarks] = useState<Mark[]>([])
  const [markDrafts, setMarkDrafts] = useState<Record<string, string>>({})
  const [selectedSubjectId, setSelectedSubjectId] = useState('')
  const [reportRemarks, setReportRemarks] = useState({ classTeacher: '', headteacher: '' })
  const [gradingBands, setGradingBands] = useState<GradeBand[]>([])
  const [schoolProfile, setSchoolProfile] = useState<SchoolProfile>({})
  const [draftBands, setDraftBands] = useState<GradeBand[]>([])
  const [historyStudentId, setHistoryStudentId] = useState('')
  const [historyMarks, setHistoryMarks] = useState<Mark[]>([])
  const [historyError, setHistoryError] = useState('')
  const [selectedExamId, setSelectedExamId] = useState('')
  const [activeAcademicTab, setActiveAcademicTab] = useState<'marks' | 'results' | 'grading' | 'history'>('marks')
  const [examForm, setExamForm] = useState({ name: '', class_id: '', term: 'Term 1', year: String(new Date().getFullYear()) })
  const [showExamForm, setShowExamForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function loadSetup() {
    setLoading(true)
    setError('')
    try {
      const [examRows, subjectRows, gradeRows, profile] = await Promise.all([
        request<Exam[]>('exams', token),
        request<Subject[]>('subjects', token),
        request<GradeBand[]>('grading-scale', token),
        request<SchoolProfile>('settings/school-profile', token),
      ])
      setExams(examRows)
      setSubjects(subjectRows)
      setGradingBands(gradeRows)
      setSchoolProfile(profile || {})
      setDraftBands(gradeRows.map(({ grade, min_score, max_score, remark }) => ({ grade, min_score, max_score, remark })))
      if (selectedExamId && examRows.some(exam => String(exam.id) === selectedExamId)) {
        setSelectedExamId(selectedExamId)
      } else {
        setSelectedExamId(examRows.length ? String(examRows[0].id) : '')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load examinations.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadSetup() }, [token])

  const selectedExam = exams.find(exam => String(exam.id) === selectedExamId) || null

  useEffect(() => {
    if (!selectedExam) {
      setStudents([])
      setMarks([])
      return
    }
    let cancelled = false
    setError('')
    Promise.all([
      fetchClassStudents(token, selectedExam.class_id),
      request<Mark[]>(`marks?exam_id=${selectedExam.id}`, token),
    ]).then(([studentRows, markRows]) => {
      if (cancelled) return
      setStudents(studentRows)
      setMarks(markRows)
      setMarkDrafts(Object.fromEntries(markRows.map(mark => [String(mark.student_id) + ':' + String(mark.subject_id), String(Math.round(mark.score))])))
    }).catch(e => {
      if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load this examination.')
    })
    return () => { cancelled = true }
  }, [selectedExamId, token, selectedExam?.class_id])

  useEffect(() => {
    if (!historyStudentId) {
      setHistoryMarks([])
      setHistoryError('')
      return
    }
    let cancelled = false
    setHistoryError('')
    request<Mark[]>(`marks?student_id=${historyStudentId}`, token).then(rows => {
      if (!cancelled) setHistoryMarks(rows)
    }).catch(e => {
      if (!cancelled) setHistoryError(e instanceof Error ? e.message : 'Unable to load student academic history.')
    })
    return () => { cancelled = true }
  }, [historyStudentId, token])

  const studentById = useMemo(() => new Map(students.map(student => [student.id, student])), [students])
  const results = useMemo(() => {
    const totals = new Map<number, { total: number; count: number }>()
    for (const mark of marks) {
      const current = totals.get(mark.student_id) || { total: 0, count: 0 }
      current.total += mark.score
      current.count += 1
      totals.set(mark.student_id, current)
    }
    return [...totals.entries()].map(([studentId, value]) => ({
      studentId,
      total: value.total,
      count: value.count,
      average: value.count ? value.total / value.count : 0,
    })).map(result => ({
      ...result,
      grade: gradingBands.find(band => result.average >= band.min_score && (result.average < band.max_score || band.max_score === 100))?.grade || '—',
    })).sort((a, b) => b.average - a.average || b.total - a.total || a.studentId - b.studentId)
      .map((result, index, rows) => ({
        ...result,
        position: index + 1 - rows.slice(0, index).filter(previous =>
          Math.round(previous.average) === Math.round(result.average)
        ).length,
      }))
  }, [marks, gradingBands])

  const subjectAnalysis = useMemo(() => subjects.map(subject => {
    const rows = marks.filter(mark => mark.subject_id === subject.id)
    return { subject, count: rows.length, average: rows.length ? rows.reduce((sum, mark) => sum + mark.score, 0) / rows.length : 0 }
  }).filter(row => row.count), [subjects, marks])

  async function createExam(event: FormEvent) {
    event.preventDefault()
    if (!examForm.name.trim() || !examForm.class_id || !examForm.year.trim()) {
      setError('Complete the examination name, class and academic year before saving.')
      return
    }
    setSaving(true); setError(''); setMessage('')
    try {
      const created = await request<Exam>('exams', token, {
        method: 'POST',
        body: JSON.stringify({ ...examForm, name: examForm.name.trim(), class_id: Number(examForm.class_id), year: Number(examForm.year) }),
      })
      const next = await request<Exam[]>('exams', token)
      setExams(next)
      setSelectedExamId(String(created.id))
      setShowExamForm(false)
      setExamForm(old => ({ ...old, name: '' }))
      setMessage('Examination created for the selected class.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to create examination.')
    } finally {
      setSaving(false)
    }
  }

  async function saveClassMarks() {
    if (!selectedExam || !students.length || !selectedSubjectId) {
      setError('Select a subject before entering marks.')
      return
    }
    const subject = subjects.find(item => String(item.id) === selectedSubjectId)
    if (!subject) return
    setSaving(true); setError(''); setMessage('')
    let saved = 0
    try {
      for (const student of students) {
        const key = String(student.id) + ':' + selectedSubjectId
        const raw = markDrafts[key]
        if (raw === undefined || raw.trim() === '') continue
        const score = Number(raw)
        if (!Number.isFinite(score) || !Number.isInteger(score) || score < 0 || score > 100) throw new Error('Enter a valid score from 0 to 100 for ' + studentName(student) + '.')
        const existing = marks.find(mark => mark.student_id === student.id && String(mark.subject_id) === selectedSubjectId)
        if (existing && existing.verified) continue
        if (existing && Number(existing.score) === score) continue
        if (existing) await request<Mark>('marks/' + existing.id, token, { method: 'PATCH', body: JSON.stringify({ score }) })
        else await request<Mark>('marks', token, { method: 'POST', body: JSON.stringify({ exam_id: selectedExam.id, student_id: student.id, subject_id: Number(selectedSubjectId), score }) })
        saved += 1
      }
      const next = await request<Mark[]>('marks?exam_id=' + selectedExam.id, token)
      setMarks(next)
      setMarkDrafts(Object.fromEntries(next.map(mark => [String(mark.student_id) + ':' + String(mark.subject_id), String(Math.round(mark.score))])))
      setMessage(saved + ' ' + subject.name + ' score(s) saved.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save subject marks.') }
    finally { setSaving(false) }
  }

  async function setMarkVerification(mark: Mark, verified: boolean) {
    setSaving(true); setError(''); setMessage('')
    try {
      await request<Mark>(`marks/${mark.id}/verification?verified=${verified}`, token, { method: 'PATCH' })
      const next = await request<Mark[]>(`marks?exam_id=${selectedExam?.id}`, token)
      setMarks(next)
      setMessage(verified ? 'Mark verified and locked against further edits.' : 'Mark unlocked for correction.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to update mark verification.')
    } finally { setSaving(false) }
  }

  async function saveGradingScale(event: FormEvent) {
    event.preventDefault()
    setSaving(true); setError(''); setMessage('')
    try {
      const rows = await request<GradeBand[]>('grading-scale', token, {
        method: 'PUT',
        body: JSON.stringify({ bands: draftBands }),
      })
      setGradingBands(rows)
      setDraftBands(rows.map(({ grade, min_score, max_score, remark }) => ({ grade, min_score, max_score, remark })))
      setMessage('School grading scale saved.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save grading scale.')
    } finally {
      setSaving(false)
    }
  }

  function printAcademicSection(target: 'results' | 'report') {
    const cleanup = () => { delete document.body.dataset.schoolbridgePrint }
    document.body.dataset.schoolbridgePrint = target
    window.addEventListener('afterprint', cleanup, { once: true })
    window.print()
  }

  const selectedClass = classes.find(item => item.id === selectedExam?.class_id)
  const historyStudent = students.find(student => String(student.id) === historyStudentId)
  const verifiedHistoryMarks = historyMarks.filter(mark => mark.verified)
  const historyRows = verifiedHistoryMarks.map(mark => ({
    ...mark,
    exam: exams.find(exam => exam.id === mark.exam_id),
    subject: subjects.find(subject => subject.id === mark.subject_id),
    grade: gradingBands.find(band => mark.score >= band.min_score && (mark.score < band.max_score || band.max_score === 100))?.grade || '—',
  })).sort((a, b) => (b.exam?.year || 0) - (a.exam?.year || 0) || (a.exam?.term || '').localeCompare(b.exam?.term || ''))

  return <div className="academic-workspace">
    <section className="panel">
      <div className="panel-heading">
        <div><h2>Examinations and results</h2><p>Set up class examinations, enter and correct marks, and review class performance.</p></div>
        <button type="button" className="secondary-button" onClick={() => void loadSetup()} disabled={loading || saving}><RefreshCw size={15}/> Refresh</button>
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
      {message && <div className="success-notice" role="status">{message}</div>}
      <div className="finance-toolbar">
        <label className="academic-exam-select">Selected examination
          <select value={selectedExamId} onChange={e => setSelectedExamId(e.target.value)}>
            <option value="">Choose an examination</option>
            {exams.map(exam => <option key={exam.id} value={exam.id}>{exam.name} · {exam.term} {exam.year} · {classes.find(item => item.id === exam.class_id)?.name || 'Unassigned class'}</option>)}
          </select>
        </label>
        <button type="button" className="primary-button" onClick={() => setShowExamForm(value => !value)}><Plus size={16}/>{showExamForm ? 'Close form' : 'Create examination'}</button>
      </div>
      {showExamForm && <form className="student-form registration-form" onSubmit={createExam}>
        <div className="form-section">
          <div className="form-section-heading"><span className="form-section-number">01</span><div><h3>Examination details</h3><p>Each examination belongs to one class, term and academic year.</p></div></div>
          <div className="student-form-grid">
            <label>Examination name *<input required maxLength={100} value={examForm.name} onChange={e => setExamForm({ ...examForm, name: e.target.value })} placeholder="e.g. Beginning of Term Examination"/></label>
            <label>Class *<select required value={examForm.class_id} onChange={e => setExamForm({ ...examForm, class_id: e.target.value })}><option value="">Choose class</option>{classes.map(item => <option key={item.id} value={item.id}>{item.name}{item.section ? ' — ' + item.section : ''}</option>)}</select></label>
            <label>Term *<select value={examForm.term} onChange={e => setExamForm({ ...examForm, term: e.target.value })}><option>Term 1</option><option>Term 2</option><option>Term 3</option></select></label>
            <label>Academic year *<input required type="number" min="2000" max="2100" value={examForm.year} onChange={e => setExamForm({ ...examForm, year: e.target.value })}/></label>
          </div>
        </div>
        <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setShowExamForm(false)}>Cancel</button><button className="primary-button" disabled={saving || !classes.length}>{saving ? 'Saving...' : 'Create examination'}</button></div>
      </form>}
    </section>

    {selectedExam && <>
      <section className="panel">
        <div className="panel-heading"><div><h2>{selectedExam.name}</h2><p>{selectedClass?.name || 'Class'}{selectedClass?.section ? ' — ' + selectedClass.section : ''} · {selectedExam.term} {selectedExam.year}</p></div><button type="button" className="secondary-button" onClick={() => printAcademicSection('results')}><Printer size={15}/> Print results</button></div>
        <div className="stats-grid finance-stats">
          <div className="stat-card"><span>Students in class</span><strong className="stat-value">{students.length}</strong></div>
          <div className="stat-card"><span>Marks recorded</span><strong className="stat-value">{marks.length}</strong></div>
          <div className="stat-card"><span>Subjects assessed</span><strong className="stat-value">{subjectAnalysis.length}</strong></div>
          <div className="stat-card"><span>Students with results</span><strong className="stat-value">{results.length}</strong></div>
          <div className="stat-card"><span>Verified marks</span><strong className="stat-value">{marks.filter(mark => mark.verified).length} / {marks.length}</strong></div>
        </div>
      </section>
      <nav className="academic-tabs" aria-label="Academic workspace tabs">{([["marks", "Marks entry"], ["results", "Class performance"], ["grading", "Grading scale"], ["history", "Report cards"]] as const).map(([key, label]) => <button key={key} type="button" className={activeAcademicTab === key ? "academic-tab active" : "academic-tab"} aria-current={activeAcademicTab === key ? "page" : undefined} onClick={() => setActiveAcademicTab(key)}>{label}</button>)}</nav>


      {activeAcademicTab === 'marks' && (
      <section className="panel subject-marks-workspace">
        <div className="panel-heading"><div><h2>Enter subject marks</h2><p>Select the subject you teach, then enter scores beside each student. Only the selected subject is shown.</p></div></div>
        <div className="subject-marks-toolbar">
          <label className="academic-exam-select">Subject to enter
            <select value={selectedSubjectId} onChange={e => setSelectedSubjectId(e.target.value)}>
              <option value="">Choose your subject</option>
              {subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
            </select>
          </label>
          <div className="subject-marks-count"><strong>{students.length}</strong><span>students in this class</span></div>
          <button type="button" className="primary-button" onClick={() => void saveClassMarks()} disabled={saving || !students.length || !selectedSubjectId}><Save size={15}/>{saving ? 'Saving scores…' : 'Save subject scores'}</button>
        </div>
        {!students.length && <p className="form-hint">No students are registered in this class yet.</p>}
        {!subjects.length && <p className="form-hint">No subjects are configured for this school type.</p>}
        {!!students.length && !selectedSubjectId && <div className="subject-marks-empty"><BookOpen size={25}/><strong>Choose a subject to begin</strong><span>The student list and score boxes will appear here.</span></div>}
        {!!students.length && !!selectedSubjectId && <div className="student-score-list">
          <div className="student-score-list-heading"><span>STUDENT</span><span>ADMISSION NUMBER</span><span>SCORE / 100</span><span>STATUS</span></div>
          {students.map((student, index) => {
            const mark = marks.find(row => row.student_id === student.id && String(row.subject_id) === selectedSubjectId)
            const key = String(student.id) + ':' + selectedSubjectId
            return <div className="student-score-row" key={student.id}>
              <div className="student-score-name"><span className="student-score-number">{index + 1}</span><strong>{studentName(student)}</strong></div>
              <span className="student-score-admission">{student.admission_number}</span>
              <input className="student-score-input" aria-label={studentName(student) + ' score'} type="number" min="0" max="100" step="1" inputMode="numeric" placeholder="Enter score" value={markDrafts[key] ?? ''} disabled={!!mark?.verified || saving} onChange={event => setMarkDrafts(current => ({ ...current, [key]: event.target.value }))}/>
              <span className={mark?.verified ? 'student-score-status verified' : mark ? 'student-score-status recorded' : 'student-score-status pending'}>{mark?.verified ? 'Verified' : mark ? 'Recorded' : 'Not entered'}</span>
            </div>
          })}
          <div className="student-score-footer"><span>Blank scores are skipped. Scores must be between 0 and 100.</span><button type="button" className="primary-button" onClick={() => void saveClassMarks()} disabled={saving}><Save size={15}/>{saving ? 'Saving…' : 'Save scores'}</button></div>
        </div>}
        <details className="recorded-marks-details"><summary>Recorded scores · by subject and verification status</summary>
          <div className="recorded-subject-groups">
            {subjects.filter(subject => marks.some(mark => mark.subject_id === subject.id)).map(subject => {
              const subjectMarks = marks.filter(mark => mark.subject_id === subject.id).sort((a, b) => studentName(studentById.get(a.student_id)).localeCompare(studentName(studentById.get(b.student_id))));
              const verifiedMarks = subjectMarks.filter(mark => mark.verified);
              const unverifiedMarks = subjectMarks.filter(mark => !mark.verified);
              const renderMarkRows = (rows: Mark[]) => rows.map(mark => <tr key={mark.id}><td>{studentName(studentById.get(mark.student_id))}</td><td><strong>{Math.round(mark.score)}</strong></td><td><button type="button" className="secondary-button" onClick={() => void setMarkVerification(mark, !mark.verified)} disabled={saving}>{mark.verified ? 'Unlock' : 'Verify'}</button></td></tr>);
              return <section className="recorded-subject-card" key={subject.id}>
                <div className="recorded-subject-heading"><h3>{subject.name}</h3><span>{subjectMarks.length} recorded</span></div>
                <div className="recorded-status-columns">
                  <div className="recorded-status-group">
                    <div className="recorded-status-heading"><strong>Verified scores</strong><span className="recorded-count verified-count">{verifiedMarks.length}</span></div>
                    <div className="table-wrap"><table><thead><tr><th>Student</th><th>Score</th><th>Action</th></tr></thead><tbody>{renderMarkRows(verifiedMarks)}{!verifiedMarks.length && <tr><td colSpan={3}>No verified scores.</td></tr>}</tbody></table></div>
                  </div>
                  <div className="recorded-status-group">
                    <div className="recorded-status-heading"><strong>Unverified scores</strong><span className="recorded-count pending-count">{unverifiedMarks.length}</span></div>
                    <div className="table-wrap"><table><thead><tr><th>Student</th><th>Score</th><th>Action</th></tr></thead><tbody>{renderMarkRows(unverifiedMarks)}{!unverifiedMarks.length && <tr><td colSpan={3}>No unverified scores.</td></tr>}</tbody></table></div>
                  </div>
                </div>
              </section>;
            })}
            {!marks.length && <p className="form-hint">No marks have been recorded for this examination yet.</p>}
          </div>
        </details>
      </section>
      )}

      {activeAcademicTab === 'results' && (
      <section className="panel academic-results-print">
        <div className="panel-heading report-screen-controls"><div><h2>Class performance</h2><p>{selectedExam.name} · {selectedClass?.name || 'Class'}{selectedClass?.section ? ' — ' + selectedClass.section : ''} · {selectedExam.term} {selectedExam.year}</p><p>Provisional ranking uses average scores. Complete and verify all subject marks before issuing final results.</p></div><button type="button" className="secondary-button" onClick={() => printAcademicSection('results')}><Printer size={15}/> Print class performance</button></div>
        <div className="table-wrap"><table><thead><tr><th>Position</th><th>Student</th><th>Admission no.</th><th>Subjects entered</th><th>Total</th><th>Average</th><th>Grade</th></tr></thead><tbody>
          {results.map(result => <tr key={result.studentId}><td>{result.position}</td><td>{studentName(studentById.get(result.studentId))}</td><td>{studentById.get(result.studentId)?.admission_number || '—'}</td><td>{result.count}</td><td>{Math.round(result.total)}</td><td>{Math.round(result.average)}%</td><td>{result.grade}</td></tr>)}
          {!results.length && <tr><td colSpan={7}>Performance positions will appear after marks are entered.</td></tr>}
        </tbody></table></div>
        <div className="panel-heading"><div><h3>Subject analysis</h3><p>Average score for each subject with recorded marks.</p></div></div>
        <div className="table-wrap"><table><thead><tr><th>Subject</th><th>Students assessed</th><th>Average score</th></tr></thead><tbody>
          {subjectAnalysis.map(row => <tr key={row.subject.id}><td>{row.subject.name}</td><td>{row.count}</td><td>{Math.round(row.average)}%</td></tr>)}
          {!subjectAnalysis.length && <tr><td colSpan={3}>Subject analysis will appear after marks are entered.</td></tr>}
        </tbody></table></div>
      </section>
      )}
      {activeAcademicTab === 'grading' && (
      <section className="panel">
        <div className="panel-heading"><div><h2>School grading scale</h2><p>Configure the grade boundaries and remarks used for student averages. Bands must cover 0–100 without gaps or overlaps.</p></div></div>
        {gradingBands.length === 0 && <p className="form-hint">No grading scale is configured yet. Add bands to display grades in class performance.</p>}
        <form className="student-form" onSubmit={saveGradingScale}>
          {draftBands.map((band, index) => <div className="student-form-grid" key={index}>
            <label>Grade *<input required maxLength={20} value={band.grade} onChange={e => setDraftBands(rows => rows.map((row, i) => i === index ? { ...row, grade: e.target.value } : row))} placeholder="e.g. A"/></label>
            <label>Minimum score *<input required type="number" min="0" max="100" step="1" value={band.min_score} onChange={e => setDraftBands(rows => rows.map((row, i) => i === index ? { ...row, min_score: Number(e.target.value) } : row))}/></label>
            <label>Maximum score *<input required type="number" min="0" max="100" step="1" value={band.max_score} onChange={e => setDraftBands(rows => rows.map((row, i) => i === index ? { ...row, max_score: Number(e.target.value) } : row))}/></label>
            <label>Remark<input maxLength={100} value={band.remark} onChange={e => setDraftBands(rows => rows.map((row, i) => i === index ? { ...row, remark: e.target.value } : row))} placeholder="Optional comment"/></label>
            <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setDraftBands(rows => rows.filter((_, i) => i !== index))}>Remove band</button></div>
          </div>)}
          <div className="form-actions">
            <button type="button" className="secondary-button" onClick={() => setDraftBands(rows => [...rows, { grade: '', min_score: rows.length ? rows[rows.length - 1].max_score : 0, max_score: 100, remark: '' }])}>Add grade band</button>
            <button className="primary-button" disabled={saving || !draftBands.length}>{saving ? 'Saving...' : 'Save grading scale'}</button>
          </div>
        </form>
      </section>
      )}
      {activeAcademicTab === 'history' && (
      <section className="panel academic-report-print">
        <div className="panel-heading report-screen-controls"><div><h2>Student report cards</h2><p>Prepare a formal academic report with subject results and remarks from the class teacher and headteacher.</p></div><button type="button" className="secondary-button" disabled={!historyStudentId||!historyRows.length} onClick={() => printAcademicSection('report')}><Printer size={15}/> Print report card</button></div>
        <label className="academic-exam-select report-student-picker">Select student
          <select value={historyStudentId} onChange={e => setHistoryStudentId(e.target.value)}>
            <option value="">Choose a student</option>
            {students.map(student => <option key={student.id} value={student.id}>{studentName(student)} · {student.admission_number}</option>)}
          </select>
        </label>
        {historyError && <div className="form-error" role="alert">{historyError}</div>}
        {historyStudent && <>
          <div className="report-card-sheet">
            <header className="report-card-header">
              <div className="report-school-emblem">SB</div>
              <div className="report-school-title"><span>OFFICIAL ACADEMIC RECORD</span><h2>{schoolProfile.name || "SCHOOL NAME"}</h2><p>{[schoolProfile.address, schoolProfile.phone, schoolProfile.email].filter(Boolean).join(" · ") || "School address · Telephone · Email"}</p>{schoolProfile.motto && <em>{schoolProfile.motto}</em>}<strong>STUDENT PROGRESS REPORT</strong></div>
              <div className="report-card-term"><span>ACADEMIC YEAR</span><strong>{selectedExam?.year || new Date().getFullYear()}</strong><span>TERM</span><strong>{selectedExam?.term || '—'}</strong></div>
            </header>
            <div className="report-student-details">
              <div><small>STUDENT NAME</small><strong>{studentName(historyStudent)}</strong></div>
              <div><small>ADMISSION NUMBER</small><strong>{historyStudent.admission_number}</strong></div>
              <div><small>CLASS</small><strong>{selectedClass?.name || '—'} {selectedClass?.section || ''}</strong></div>
              <div><small>EXAMINATION</small><strong>{selectedExam?.name || 'Academic record'}</strong></div>
            </div>
            <div className="report-section-heading"><span>01</span><h3>Academic performance</h3></div>
            <div className="table-wrap report-results-table"><table><thead><tr><th>SUBJECT</th><th>SCORE</th><th>GRADE</th><th>TEACHER'S SUBJECT REMARK</th></tr></thead><tbody>
              {historyRows.filter(mark => !selectedExam || mark.exam_id === selectedExam.id).map(mark => <tr key={mark.id}><td><strong>{mark.subject?.name || 'Unknown subject'}</strong></td><td>{Math.round(mark.score)}%</td><td><strong>{mark.grade}</strong></td><td>{gradingBands.find(band => band.grade === mark.grade)?.remark || '—'}</td></tr>)}
              {!historyRows.filter(mark => !selectedExam || mark.exam_id === selectedExam.id).length && <tr><td colSpan={4}>No verified subject results for the selected examination.</td></tr>}
            </tbody></table></div>
            <div className="report-summary-grid"><div><small>SUBJECTS GRADED</small><strong>{historyRows.filter(mark => !selectedExam || mark.exam_id === selectedExam.id).length}</strong></div><div><small>AVERAGE SCORE</small><strong>{Math.round(historyRows.filter(mark => !selectedExam || mark.exam_id === selectedExam.id).length ? historyRows.filter(mark => !selectedExam || mark.exam_id === selectedExam.id).reduce((sum, mark) => sum + mark.score, 0) / historyRows.filter(mark => !selectedExam || mark.exam_id === selectedExam.id).length : 0)}%</strong></div><div><small>OVERALL GRADE</small><strong>{gradingBands.find(band => { const rows = historyRows.filter(mark => !selectedExam || mark.exam_id === selectedExam.id); const avg = rows.length ? rows.reduce((sum, mark) => sum + mark.score, 0) / rows.length : 0; return avg >= band.min_score && (avg < band.max_score || band.max_score === 100) })?.grade || '—'}</strong></div></div>
            <div className="report-section-heading"><span>02</span><h3>Progress remarks and recommendations</h3></div>
            <div className="report-remarks-grid">
              <label>Class teacher's remarks<textarea value={reportRemarks.classTeacher} onChange={e => setReportRemarks(v => ({ ...v, classTeacher: e.target.value }))} placeholder="Comment on attendance, conduct, participation and general progress."/></label>
              <label>Headteacher's remarks<textarea value={reportRemarks.headteacher} onChange={e => setReportRemarks(v => ({ ...v, headteacher: e.target.value }))} placeholder="School leadership comments and recommendations."/></label>
            </div>
            <div className="report-signatures"><div><strong>Class teacher</strong><span>Signature: __________________</span><span>Date: __________________</span></div><div><strong>Headteacher</strong><span>Signature: __________________</span><span>Date: __________________</span></div></div>
            <footer className="report-card-footer">SchoolBridge · Official student progress report · Keep this report for your records</footer>
          </div>
        </>}
      </section>
      )}

    </>}
    {!selectedExam && !loading && <section className="panel empty-state"><BookOpen size={32}/><h3>No examination selected</h3><p>Create an examination for a class to begin recording results.</p></section>}
  </div>
}
