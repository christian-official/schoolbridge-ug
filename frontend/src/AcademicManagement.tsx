import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { BookOpen, Plus, RefreshCw, Save, Printer } from 'lucide-react'

type SchoolClass = { id: number; name?: string; section?: string }
type Subject = { id: number; name: string }
type Student = { id: number; first_name: string; middle_name?: string | null; last_name: string; admission_number: string; class_id?: number | null }
type Exam = { id: number; name: string; term: string; year: number; class_id: number | null }
type Mark = { id: number; student_id: number; subject_id: number; exam_id: number; score: number; verified: boolean }
type GradeBand = { id?: number; grade: string; min_score: number; max_score: number; remark: string }
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
  const [gradingBands, setGradingBands] = useState<GradeBand[]>([])
  const [draftBands, setDraftBands] = useState<GradeBand[]>([])
  const [historyStudentId, setHistoryStudentId] = useState('')
  const [historyMarks, setHistoryMarks] = useState<Mark[]>([])
  const [historyError, setHistoryError] = useState('')
  const [selectedExamId, setSelectedExamId] = useState('')
  const [examForm, setExamForm] = useState({ name: '', class_id: '', term: 'Term 1', year: String(new Date().getFullYear()) })
  const [markForm, setMarkForm] = useState({ student_id: '', subject_id: '', score: '' })
  const [editingMarkId, setEditingMarkId] = useState<number | null>(null)
  const [showExamForm, setShowExamForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function loadSetup() {
    setLoading(true)
    setError('')
    try {
      const [examRows, subjectRows, gradeRows] = await Promise.all([
        request<Exam[]>('exams', token),
        request<Subject[]>('subjects', token),
        request<GradeBand[]>('grading-scale', token),
      ])
      setExams(examRows)
      setSubjects(subjectRows)
      setGradingBands(gradeRows)
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
  const subjectById = useMemo(() => new Map(subjects.map(subject => [subject.id, subject])), [subjects])
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
    })).sort((a, b) => b.total - a.total || a.studentId - b.studentId)
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

  async function saveMark(event: FormEvent) {
    event.preventDefault()
    if (!selectedExam || !markForm.student_id || !markForm.subject_id || markForm.score === '') {
      setError('Select a student and subject, then enter a mark from 0 to 100.')
      return
    }
    const score = Number(markForm.score)
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      setError('Marks must be between 0 and 100.')
      return
    }
    setSaving(true); setError(''); setMessage('')
    try {
      const existing = editingMarkId ? marks.find(mark => mark.id === editingMarkId) : marks.find(mark => mark.student_id === Number(markForm.student_id) && mark.subject_id === Number(markForm.subject_id))
      if (existing) {
        if (existing.verified) throw new Error('This mark is verified. Unlock it before making corrections.')
        await request<Mark>(`marks/${existing.id}`, token, { method: 'PATCH', body: JSON.stringify({ score }) })
      } else {
        await request<Mark>('marks', token, { method: 'POST', body: JSON.stringify({ exam_id: selectedExam.id, student_id: Number(markForm.student_id), subject_id: Number(markForm.subject_id), score }) })
      }
      const next = await request<Mark[]>(`marks?exam_id=${selectedExam.id}`, token)
      setMarks(next)
      setMarkForm({ student_id: '', subject_id: '', score: '' })
      setEditingMarkId(null)
      setMessage(existing ? 'Mark updated successfully.' : 'Mark recorded successfully.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save mark.')
    } finally {
      setSaving(false)
    }
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

  function editMark(mark: Mark) {
    if (mark.verified) { setError('Unlock this verified mark before editing it.'); return }
    setEditingMarkId(mark.id)
    setMarkForm({ student_id: String(mark.student_id), subject_id: String(mark.subject_id), score: String(mark.score) })
    setError('')
    setMessage('Edit the selected mark and save your changes.')
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

  const selectedClass = classes.find(item => item.id === selectedExam?.class_id)
  const historyStudent = students.find(student => String(student.id) === historyStudentId)
  const historyRows = historyMarks.map(mark => ({
    ...mark,
    exam: exams.find(exam => exam.id === mark.exam_id),
    subject: subjects.find(subject => subject.id === mark.subject_id),
    grade: gradingBands.find(band => mark.score >= band.min_score && (mark.score < band.max_score || band.max_score === 100))?.grade || '—',
  })).sort((a, b) => (b.exam?.year || 0) - (a.exam?.year || 0) || (a.exam?.term || '').localeCompare(b.exam?.term || ''))
  const historyAverage = historyMarks.length ? historyMarks.reduce((sum, mark) => sum + mark.score, 0) / historyMarks.length : 0

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
          <select value={selectedExamId} onChange={e => { setSelectedExamId(e.target.value); setEditingMarkId(null); setMarkForm({ student_id: '', subject_id: '', score: '' }) }}>
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
        <div className="panel-heading"><div><h2>{selectedExam.name}</h2><p>{selectedClass?.name || 'Class'}{selectedClass?.section ? ' — ' + selectedClass.section : ''} · {selectedExam.term} {selectedExam.year}</p></div><button type="button" className="secondary-button" onClick={() => window.print()}><Printer size={15}/> Print results</button></div>
        <div className="stats-grid finance-stats">
          <div className="stat-card"><span>Students in class</span><strong className="stat-value">{students.length}</strong></div>
          <div className="stat-card"><span>Marks recorded</span><strong className="stat-value">{marks.length}</strong></div>
          <div className="stat-card"><span>Subjects assessed</span><strong className="stat-value">{subjectAnalysis.length}</strong></div>
          <div className="stat-card"><span>Students with results</span><strong className="stat-value">{results.length}</strong></div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading"><div><h2>Marks entry</h2><p>Record a score or select an existing mark to correct it. Scores are limited to 0–100.</p></div></div>
        <form className="student-form" onSubmit={saveMark}>
          <div className="student-form-grid">
            <label>Student *<select required value={markForm.student_id} onChange={e => setMarkForm({ ...markForm, student_id: e.target.value })}><option value="">Select student</option>{students.map(student => <option key={student.id} value={student.id}>{studentName(student)} · {student.admission_number}</option>)}</select></label>
            <label>Subject *<select required value={markForm.subject_id} onChange={e => setMarkForm({ ...markForm, subject_id: e.target.value })}><option value="">Select subject</option>{subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
            <label>Score (0–100) *<input required type="number" min="0" max="100" step="0.01" value={markForm.score} onChange={e => setMarkForm({ ...markForm, score: e.target.value })} placeholder="Enter score"/></label>
          </div>
          <div className="form-actions">
            {editingMarkId !== null && <button type="button" className="secondary-button" onClick={() => { setEditingMarkId(null); setMarkForm({ student_id: '', subject_id: '', score: '' }) }}>Cancel edit</button>}
            <button className="primary-button" disabled={saving || !students.length || !subjects.length}><Save size={15}/>{saving ? 'Saving...' : editingMarkId !== null ? 'Update mark' : 'Record mark'}</button>
          </div>
        </form>
        {!students.length && <p className="form-hint">No students are registered in this class yet.</p>}
        {!subjects.length && <p className="form-hint">Add school subjects under Settings before entering marks.</p>}
        <div className="table-wrap"><table><thead><tr><th>Student</th><th>Admission no.</th><th>Subject</th><th>Score</th><th>Verification</th><th>Action</th></tr></thead><tbody>
          {marks.map(mark => <tr key={mark.id}><td>{studentName(studentById.get(mark.student_id))}</td><td>{studentById.get(mark.student_id)?.admission_number || '—'}</td><td>{subjectById.get(mark.subject_id)?.name || 'Unknown subject'}</td><td><strong>{mark.score.toFixed(2)}</strong></td><td>{mark.verified ? 'Verified' : 'Pending'}</td><td><button type="button" className="secondary-button" onClick={() => void setMarkVerification(mark, !mark.verified)} disabled={saving}>{mark.verified ? 'Unlock' : 'Verify'}</button> <button type="button" className="secondary-button" onClick={() => editMark(mark)} disabled={mark.verified}>Edit</button></td></tr>)}
          {!marks.length && <tr><td colSpan={6}>No marks have been entered for this examination.</td></tr>}
        </tbody></table></div>
      </section>

      <section className="panel">
        <div className="panel-heading"><div><h2>Class performance</h2><p>Provisional ranking is based on total marks entered so far. Complete all subject marks before confirming positions.</p></div></div>
        <div className="table-wrap"><table><thead><tr><th>Position</th><th>Student</th><th>Admission no.</th><th>Subjects entered</th><th>Total</th><th>Average</th><th>Grade</th></tr></thead><tbody>
          {results.map((result, index) => <tr key={result.studentId}><td>{index + 1}</td><td>{studentName(studentById.get(result.studentId))}</td><td>{studentById.get(result.studentId)?.admission_number || '—'}</td><td>{result.count}</td><td>{result.total.toFixed(2)}</td><td>{result.average.toFixed(2)}%</td><td>{result.grade}</td></tr>)}
          {!results.length && <tr><td colSpan={7}>Performance positions will appear after marks are entered.</td></tr>}
        </tbody></table></div>
        <div className="panel-heading"><div><h3>Subject analysis</h3><p>Average score for each subject with recorded marks.</p></div></div>
        <div className="table-wrap"><table><thead><tr><th>Subject</th><th>Students assessed</th><th>Average score</th></tr></thead><tbody>
          {subjectAnalysis.map(row => <tr key={row.subject.id}><td>{row.subject.name}</td><td>{row.count}</td><td>{row.average.toFixed(2)}%</td></tr>)}
          {!subjectAnalysis.length && <tr><td colSpan={3}>Subject analysis will appear after marks are entered.</td></tr>}
        </tbody></table></div>
      </section>
      <section className="panel">
        <div className="panel-heading"><div><h2>School grading scale</h2><p>Configure the grade boundaries and remarks used for student averages. Bands must cover 0–100 without gaps or overlaps.</p></div></div>
        {gradingBands.length === 0 && <p className="form-hint">No grading scale is configured yet. Add bands to display grades in class performance.</p>}
        <form className="student-form" onSubmit={saveGradingScale}>
          {draftBands.map((band, index) => <div className="student-form-grid" key={index}>
            <label>Grade *<input required maxLength={20} value={band.grade} onChange={e => setDraftBands(rows => rows.map((row, i) => i === index ? { ...row, grade: e.target.value } : row))} placeholder="e.g. A"/></label>
            <label>Minimum score *<input required type="number" min="0" max="100" step="0.01" value={band.min_score} onChange={e => setDraftBands(rows => rows.map((row, i) => i === index ? { ...row, min_score: Number(e.target.value) } : row))}/></label>
            <label>Maximum score *<input required type="number" min="0" max="100" step="0.01" value={band.max_score} onChange={e => setDraftBands(rows => rows.map((row, i) => i === index ? { ...row, max_score: Number(e.target.value) } : row))}/></label>
            <label>Remark<input maxLength={100} value={band.remark} onChange={e => setDraftBands(rows => rows.map((row, i) => i === index ? { ...row, remark: e.target.value } : row))} placeholder="Optional comment"/></label>
            <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setDraftBands(rows => rows.filter((_, i) => i !== index))}>Remove band</button></div>
          </div>)}
          <div className="form-actions">
            <button type="button" className="secondary-button" onClick={() => setDraftBands(rows => [...rows, { grade: '', min_score: rows.length ? rows[rows.length - 1].max_score : 0, max_score: 100, remark: '' }])}>Add grade band</button>
            <button className="primary-button" disabled={saving || !draftBands.length}>{saving ? 'Saving...' : 'Save grading scale'}</button>
          </div>
        </form>
      </section>
      <section className="panel">
        <div className="panel-heading"><div><h2>Student report card and academic history</h2><p>Review this student's results across examinations and print the report card. Use the browser print option to save as PDF.</p></div><button type="button" className="secondary-button" disabled={!historyStudentId||!historyRows.length} onClick={() => window.print()}><Printer size={15}/> Print report card</button></div>
        <label className="academic-exam-select">Student
          <select value={historyStudentId} onChange={e => setHistoryStudentId(e.target.value)}>
            <option value="">Choose a student</option>
            {students.map(student => <option key={student.id} value={student.id}>{studentName(student)} · {student.admission_number}</option>)}
          </select>
        </label>
        {historyError && <div className="form-error" role="alert">{historyError}</div>}
        {historyStudent && <>
          <div className="panel-heading"><div><h3>{studentName(historyStudent)}</h3><p>Admission number: {historyStudent.admission_number}</p></div></div>
          <div className="stats-grid finance-stats">
            <div className="stat-card"><span>Assessments recorded</span><strong className="stat-value">{historyMarks.length}</strong></div>
            <div className="stat-card"><span>Overall average</span><strong className="stat-value">{historyAverage.toFixed(2)}%</strong></div>
            <div className="stat-card"><span>Overall grade</span><strong className="stat-value">{gradingBands.find(band => historyAverage >= band.min_score && (historyAverage < band.max_score || band.max_score === 100))?.grade || '—'}</strong></div>
          </div>
          <div className="table-wrap"><table><thead><tr><th>Examination</th><th>Term / year</th><th>Subject</th><th>Score</th><th>Grade</th><th>Remark</th></tr></thead><tbody>
            {historyRows.map(mark => <tr key={mark.id}><td>{mark.exam?.name || 'Archived examination'}</td><td>{mark.exam ? mark.exam.term + ' ' + mark.exam.year : '—'}</td><td>{mark.subject?.name || 'Unknown subject'}</td><td>{mark.score.toFixed(2)}</td><td>{mark.grade}</td><td>{gradingBands.find(band => band.grade === mark.grade)?.remark || '—'}</td></tr>)}
            {!historyRows.length && <tr><td colSpan={6}>No academic history has been recorded for this student yet.</td></tr>}
          </tbody></table></div>
        </>}
      </section>
    </>}
    {!selectedExam && !loading && <section className="panel empty-state"><BookOpen size={32}/><h3>No examination selected</h3><p>Create an examination for a class to begin recording results.</p></section>}
  </div>
}
