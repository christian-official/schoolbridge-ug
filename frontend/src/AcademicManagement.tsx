import { fetchSchoolBridge } from './offlineNetwork'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { BookOpen, Plus, RefreshCw, Save, Printer, LockKeyhole, Download, Upload } from 'lucide-react'
import { saveEncryptedOfflineDraft, loadEncryptedOfflineDraft, deleteEncryptedOfflineDraft } from './syncStorage'

type SchoolClass = { id: number; name?: string; section?: string }
type Subject = { id: number; name: string; code?: string | null }
type Student = { id: number; first_name: string; middle_name?: string | null; last_name: string; admission_number: string; class_id?: number | null; academic_level?: string | null; combination?: string | null; optional_subjects?: string | null; subsidiary_subjects?: string | null }
type Exam = { id: number; name: string; exam_type: string; term: string; year: number; class_id: number | null; status: 'draft' | 'closed' | 'published'; closed_at?: string | null; published_at?: string | null }
type Mark = { id: number; student_id: number; subject_id: number; exam_id: number; score: number; verified: boolean }
type GradeBand = { id?: number; grade: string; min_score: number; max_score: number; remark: string }
type SchoolProfile = { name?: string; address?: string | null; phone?: string | null; email?: string | null; motto?: string | null; school_type?: string; a_level_combinations?: string | null; o_level_optional_subjects?: string | null; a_level_subsidiary_subjects?: string | null; report_logo?: string | null; report_template?: string | null }
type ReportTemplateConfig = { title?: string; footer?: string }
type Page<T> = { items: T[]; total: number; pages?: number }

const EXAM_TYPES = ['Beginning of Term', 'Mid-Term', 'End of Term', 'Mock', 'Promotional', 'Other'] as const

function examGroupKey(exam: Exam) { return [exam.exam_type || 'Other', exam.term, exam.year].join('::') }



async function request<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const response = await fetchSchoolBridge(`${API_BASE_URL}/api/${path}`, {
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

function normaliseSubjectText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}

const aLevelSubjectAliases: Record<string, string> = {
  p: 'physics', phy: 'physics', phys: 'physics',
  c: 'chemistry', chem: 'chemistry',
  b: 'biology', bio: 'biology',
  m: 'mathematics', math: 'mathematics', maths: 'mathematics', mat: 'mathematics',
  e: 'economics', econ: 'economics',
  g: 'geography', geo: 'geography',
  h: 'history', hist: 'history',
  l: 'literature', lit: 'literature',
  d: 'divinity', div: 'divinity',
  a: 'agriculture', agr: 'agriculture',
  gp: 'general paper',
}

function studentOffersSubject(student: Student, subject: Subject) {
  if ((student.academic_level || '').toLowerCase().replace(/[^a-z]/g, '') !== 'alevel') return true
  const sources = [student.combination, student.optional_subjects, student.subsidiary_subjects].filter((value): value is string => !!value?.trim())
  if (!sources.length) return false

  const subjectName = normaliseSubjectText(subject.name)
  const subjectCode = normaliseSubjectText(subject.code || '')
  const allText = normaliseSubjectText(sources.join(' '))
  if (subjectName && allText.includes(subjectName)) return true
  const sourceTokens = sources.flatMap(source => normaliseSubjectText(source).split(' '))
  if (subjectCode && sourceTokens.includes(subjectCode)) return true

  for (const token of sources.flatMap(source => source.match(/[A-Za-z]+/g) || [])) {
    const key = token.toLowerCase()
    const mapped = aLevelSubjectAliases[key]
    if (mapped && (subjectName === mapped || subjectName.includes(mapped) || (subjectCode && subjectCode === key))) return true
    // Compact combinations such as PCB or BCM represent individual subject codes.
    if (/^[A-Z]{2,5}$/.test(token)) {
      for (const letter of token) {
        const letterSubject = aLevelSubjectAliases[letter.toLowerCase()]
        if (letterSubject && (subjectName === letterSubject || subjectName.includes(letterSubject))) return true
      }
    }
  }
  return false
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

export default function AcademicManagement({ token, classes, canVerify = false, userId, isTeacher = false, isAdmin = false, apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '') }: { token: string; classes: SchoolClass[]; canVerify?: boolean; userId: number; isTeacher?: boolean; isAdmin?: boolean; apiBaseUrl?: string }) {
  const [exams, setExams] = useState<Exam[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [marks, setMarks] = useState<Mark[]>([])
  const [markDrafts, setMarkDrafts] = useState<Record<string, string>>({})
  const [selectedSubjectId, setSelectedSubjectId] = useState('')
  const [reportRemarks, setReportRemarks] = useState({ classTeacher: '', headteacher: '' })
  const [reportTemplate, setReportTemplate] = useState<'classic' | 'modern' | 'detailed'>('modern')
  const [recordedSubjectFilter, setRecordedSubjectFilter] = useState('all')
  const [recordedStatusFilter, setRecordedStatusFilter] = useState<'all' | 'verified' | 'unverified'>('all')
  const [reportLogo, setReportLogo] = useState('')
  const [reportTemplateConfig, setReportTemplateConfig] = useState<ReportTemplateConfig>(() => { try { return JSON.parse(localStorage.getItem('schoolbridge-report-template') || '{}') } catch { return {} } })
  const [reportTitle, setReportTitle] = useState(() => { try { return JSON.parse(localStorage.getItem('schoolbridge-report-template') || '{}').title || 'STUDENT PROGRESS REPORT' } catch { return 'STUDENT PROGRESS REPORT' } })
  const [reportFooter, setReportFooter] = useState(() => { try { return JSON.parse(localStorage.getItem('schoolbridge-report-template') || '{}').footer || 'SchoolBridge · Official student progress report · Keep this report for your records' } catch { return 'SchoolBridge · Official student progress report · Keep this report for your records' } })
  const [gradingBands, setGradingBands] = useState<GradeBand[]>([])
  const [schoolProfile, setSchoolProfile] = useState<SchoolProfile>({})
  const [draftBands, setDraftBands] = useState<GradeBand[]>([])
  const [historyStudentId, setHistoryStudentId] = useState('')
  const [historyMarks, setHistoryMarks] = useState<Mark[]>([])
  const [historyError, setHistoryError] = useState('')
  const [selectedExamId, setSelectedExamId] = useState('')
  const [activeExamType, setActiveExamType] = useState<string>('All exams')
  const [selectedExamGroupKey, setSelectedExamGroupKey] = useState('')
  const [activeAcademicTab, setActiveAcademicTab] = useState<'marks' | 'submitted' | 'results' | 'grading' | 'history'>('marks')
  const [submittedSubjectId, setSubmittedSubjectId] = useState('')
  const [examForm, setExamForm] = useState<{exam_type:string;class_ids:number[];term:string;year:string}>({ exam_type: 'End of Term', class_ids: [], term: 'Term 1', year: String(new Date().getFullYear()) })
  const [showExamForm, setShowExamForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveProgress, setSaveProgress] = useState(0)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [offlinePassphrase, setOfflinePassphrase] = useState('')
  const [offlineMarkMessage, setOfflineMarkMessage] = useState('')
  const [offlineMarkBusy, setOfflineMarkBusy] = useState(false)
  const [markSyncBaseline, setMarkSyncBaseline] = useState<{deviceId:string;baseSequence:number}|null>(null)
  const [pendingOfflineMarkDraft, setPendingOfflineMarkDraft] = useState<any>(null)
  const [offlineMarkHistory, setOfflineMarkHistory] = useState<Array<{id:number;exam_name:string;term:string;year:number|null;subject_name:string;status:string;record_count:number;submitted_at:string;resolution:string|null;conflict_sequence:number|null}>>([])
  const [offlineConnectionOnline, setOfflineConnectionOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine)


  useEffect(() => {
    if (!isTeacher) return
    let active = true
    const refreshHistory = async () => {
      if (!navigator.onLine) { if (active) setOfflineConnectionOnline(false); return }
      try {
        const result = await request<{proposals:Array<{id:number;exam_name:string;term:string;year:number|null;subject_name:string;status:string;record_count:number;submitted_at:string;resolution:string|null;conflict_sequence:number|null}>}>('sync/teacher-mark-proposals/mine', token)
        if (active) { setOfflineMarkHistory(result.proposals || []); setOfflineConnectionOnline(true) }
      } catch { if (active) setOfflineConnectionOnline(navigator.onLine) }
    }
    const onOnline = () => { setOfflineConnectionOnline(true); setOfflineMarkMessage('Connection restored. Unlock your saved draft, review the scores, then submit it securely.'); void refreshHistory() }
    const onOffline = () => { setOfflineConnectionOnline(false); setOfflineMarkMessage('You are offline. Your encrypted draft stays on this device; official marks are unchanged.') }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    void refreshHistory()
    return () => { active = false; window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline) }
  }, [token, isTeacher])

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
      setReportLogo(profile?.report_logo || '')
      if (profile?.report_template) { try { const config = JSON.parse(profile.report_template); setReportTemplateConfig(config); setReportTitle(config.title || 'STUDENT PROGRESS REPORT'); setReportFooter(config.footer || 'SchoolBridge · Official student progress report · Keep this report for your records'); localStorage.setItem('schoolbridge-report-template', profile.report_template) } catch { /* Keep the local editable defaults if an older template cannot be parsed. */ } }
      setDraftBands(gradeRows.map(({ grade, min_score, max_score, remark }) => ({ grade, min_score, max_score, remark })))
      if (selectedExamId && examRows.some(exam => String(exam.id) === selectedExamId)) {
        setSelectedExamId(selectedExamId)
      } else {
        setSelectedExamId('')
        setSelectedExamGroupKey('')
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
    ]).then(async ([studentRows, markRows]) => {
      if (cancelled) return
      setStudents(studentRows)
      setMarks(markRows)
      const nextDrafts = Object.fromEntries(markRows.map(mark => [String(mark.student_id) + ':' + String(mark.subject_id), String(Math.round(mark.score))]))
      if (pendingOfflineMarkDraft?.examId === selectedExam.id) {
        for (const row of pendingOfflineMarkDraft.records || []) nextDrafts[String(row.student_id) + ':' + String(pendingOfflineMarkDraft.subjectId)] = String(row.score)
        setPendingOfflineMarkDraft(null)
      }
      setMarkDrafts(nextDrafts)
      if(isTeacher){const deviceId=localStorage.getItem('schoolbridge-sync-device-'+userId)||'';if(deviceId){try{const result=await request<{devices:Array<{device_id:string;active:boolean;last_issued_sequence:number}>}>('sync/devices',token);const device=result.devices.find(row=>row.device_id===deviceId&&row.active);setMarkSyncBaseline(device?{deviceId,baseSequence:device.last_issued_sequence}:null)}catch{setMarkSyncBaseline(null)}}else setMarkSyncBaseline(null)}
    }).catch(e => {
      if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load this examination.')
    })
    return () => { cancelled = true }
  }, [selectedExamId, token, selectedExam?.class_id, userId, isTeacher, pendingOfflineMarkDraft])

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

  const eligibleStudents = useMemo(() => {
    const subject = subjects.find(item => String(item.id) === selectedSubjectId)
    return subject ? students.filter(student => studentOffersSubject(student, subject)) : students
  }, [students, subjects, selectedSubjectId])

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

  const verifiedMarks = useMemo(() => marks.filter(mark => mark.verified), [marks])
  const verifiedSubjectAnalysis = useMemo(() => subjects.map(subject => {
    const rows = verifiedMarks.filter(mark => mark.subject_id === subject.id)
    return { subject, count: rows.length, average: rows.length ? rows.reduce((sum, mark) => sum + mark.score, 0) / rows.length : 0 }
  }).filter(row => row.count), [subjects, verifiedMarks])
  const verifiedResults = useMemo(() => {
    const totals = new Map<number, { total: number; count: number }>()
    for (const mark of verifiedMarks) {
      const current = totals.get(mark.student_id) || { total: 0, count: 0 }
      current.total += mark.score
      current.count += 1
      totals.set(mark.student_id, current)
    }
    return [...totals.entries()].map(([studentId, value]) => ({
      studentId, total: value.total, count: value.count, average: value.total / value.count,
      grade: gradingBands.find(band => value.total / value.count >= band.min_score && (value.total / value.count < band.max_score || band.max_score === 100))?.grade || '—',
    })).sort((a, b) => b.average - a.average || b.total - a.total || a.studentId - b.studentId)
      .map((result, index, rows) => ({ ...result, position: index + 1 - rows.slice(0, index).filter(previous => Math.round(previous.average) === Math.round(result.average)).length }))
  }, [verifiedMarks, gradingBands])

  async function createExam(event: FormEvent) {
    event.preventDefault()
    if (!examForm.class_ids.length || !examForm.year.trim() || !examForm.exam_type || !examForm.term) {
      setError('Select an examination type, term, academic year and at least one class.')
      return
    }
    setSaving(true); setError(''); setMessage('')
    try {
      const generatedExamName = examForm.exam_type
      const existing = exams.filter(exam => (exam.exam_type || 'Other') === examForm.exam_type && exam.term === examForm.term && exam.year === Number(examForm.year))
      const existingClassIds = new Set(existing.map(exam => exam.class_id))
      const classIdsToCreate = examForm.class_ids.filter(classId => !existingClassIds.has(classId))
      const skipped = examForm.class_ids.length - classIdsToCreate.length
      const created: Exam[] = []
      for (const classId of classIdsToCreate) {
        const row = await request<Exam>('exams', token, {
          method: 'POST',
          body: JSON.stringify({ name: generatedExamName, exam_type: examForm.exam_type, term: examForm.term, year: Number(examForm.year), class_id: classId }),
        })
        created.push(row)
      }
      const next = await request<Exam[]>('exams', token)
      setExams(next)
      setActiveExamType(examForm.exam_type)
      if (created.length) {
        setSelectedExamGroupKey(examGroupKey(created[0]))
        setSelectedExamId(String(created[0].id))
      }
      setShowExamForm(false)
      setExamForm(old => ({ ...old, class_ids: [] }))
      setMessage(`Examination created for ${created.length} class(es).${skipped ? ` ${skipped} already existed and were not duplicated.` : ''}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to create examination.')
    } finally {
      setSaving(false)
    }
  }

  async function changeExamLifecycle(action: 'close' | 'publish') {
    if (!selectedExam || !isAdmin) return
    const prompt = action === 'close'
      ? 'Close this examination? All existing results must be verified, and marks will become read-only.'
      : 'Publish this examination? Linked parents will be able to view its verified results.'
    if (!window.confirm(prompt)) return
    setSaving(true); setError(''); setMessage('')
    try {
      const updated = await request<{id:number;status:'closed'|'published';closed_at?:string;published_at?:string}>('exams/' + selectedExam.id + '/' + action, token, { method: 'POST' })
      setExams(current => current.map(exam => exam.id === updated.id ? { ...exam, status: updated.status, closed_at: updated.closed_at ?? exam.closed_at, published_at: updated.published_at ?? exam.published_at } : exam))
      setMessage(action === 'close' ? 'Examination closed. Results are locked and remain hidden from parents until publication.' : 'Examination results published. Linked parents can now view the verified results.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to update examination status.')
    } finally { setSaving(false) }
  }

  async function saveClassMarks() {
    if (selectedExam && selectedExam.status !== 'draft') { setError('This examination is closed. Marks are read-only.'); return }
    if (!selectedExam || !eligibleStudents.length || !selectedSubjectId) {
      setError('Select a subject before entering marks.')
      return
    }
    const subject = subjects.find(item => String(item.id) === selectedSubjectId)
    if (!subject) return
    setSaving(true); setSaveProgress(0); setError(''); setMessage('')
    let saved = 0
    try {
      for (let index = 0; index < eligibleStudents.length; index += 1) {
        const student = eligibleStudents[index]
        const key = String(student.id) + ':' + selectedSubjectId
        const raw = markDrafts[key]
        const score = raw === undefined || raw.trim() === '' ? 0 : Number(raw)
        if (!Number.isFinite(score) || !Number.isInteger(score) || score < 0 || score > 100) throw new Error('Enter a valid score from 0 to 100 for ' + studentName(student) + '.')
        const existing = marks.find(mark => mark.student_id === student.id && String(mark.subject_id) === selectedSubjectId)
        if (!(existing && existing.verified) && !(existing && Number(existing.score) === score)) {
          if (existing) await request<Mark>('marks/' + existing.id, token, { method: 'PATCH', body: JSON.stringify({ score }) })
          else await request<Mark>('marks', token, { method: 'POST', body: JSON.stringify({ exam_id: selectedExam.id, student_id: student.id, subject_id: Number(selectedSubjectId), score }) })
          saved += 1
        }
        setSaveProgress(Math.round(((index + 1) / eligibleStudents.length) * 100))
      }
      const next = await request<Mark[]>('marks?exam_id=' + selectedExam.id, token)
      setMarks(next)
      setMarkDrafts(Object.fromEntries(next.map(mark => [String(mark.student_id) + ':' + String(mark.subject_id), String(Math.round(mark.score))])))
      setSubmittedSubjectId(selectedSubjectId)
      setMessage(`${subject.name}: ${eligibleStudents.length} student results submitted. Blank scores were recorded as No score (0). Status: Submitted · Not verified.`)
      setActiveAcademicTab('submitted')
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to submit subject results.') }
    finally { setSaving(false) }
  }

  async function saveOfflineMarkDraft(){if(!selectedExam||!selectedSubjectId||!eligibleStudents.length){setOfflineMarkMessage('Select an examination and subject with students first.');return}if(offlinePassphrase.length<12){setOfflineMarkMessage('Use the 12-character-or-longer offline passphrase.');return}if(!markSyncBaseline){setOfflineMarkMessage('Connect, register this device and reload the examination to obtain a sync baseline.');return}try{const subjectId=Number(selectedSubjectId);const records=eligibleStudents.map(student=>{const raw=markDrafts[String(student.id)+':'+selectedSubjectId];const score=raw===undefined||raw.trim()===''?0:Number(raw);if(!Number.isInteger(score)||score<0||score>100)throw new Error('Enter a whole-number score from 0 to 100 for '+studentName(student)+'.');return{student_id:student.id,score}});const baseMarkIds=Object.fromEntries(eligibleStudents.map(student=>{const existing=marks.find(mark=>mark.student_id===student.id&&mark.subject_id===subjectId);return[String(student.id),existing?.id??null]}));if(eligibleStudents.some(student=>marks.some(mark=>mark.student_id===student.id&&mark.subject_id===subjectId&&mark.verified)))throw new Error('This subject contains verified results and cannot be saved as an offline draft.');const draft={version:1,userId,deviceId:markSyncBaseline.deviceId,examId:selectedExam.id,subjectId,baseSequence:markSyncBaseline.baseSequence,baseMarkIds,records,idempotencyKey:crypto.randomUUID(),savedAt:Date.now(),expiresAt:Date.now()+24*60*60*1000};await saveEncryptedOfflineDraft(userId,markSyncBaseline.deviceId,offlinePassphrase,draft,false);setOfflineMarkMessage('Encrypted marks draft saved. Official results have not been changed.')}catch(error){setOfflineMarkMessage(error instanceof Error?error.message:'Unable to save the encrypted marks draft.')}}

  async function unlockOfflineMarkDraft(){const deviceId=localStorage.getItem('schoolbridge-sync-device-'+userId)||'';if(!deviceId||offlinePassphrase.length<12){setOfflineMarkMessage('Register this device and enter the offline passphrase.');return}setOfflineMarkBusy(true);try{const draft=await loadEncryptedOfflineDraft<any>(userId,deviceId,offlinePassphrase);if(draft.version!==1||draft.userId!==userId||draft.deviceId!==deviceId||draft.expiresAt<=Date.now())throw new Error('This marks draft is expired or belongs to another account or device.');if(!exams.some(exam=>exam.id===draft.examId)||!subjects.some(subject=>subject.id===draft.subjectId))throw new Error('The examination or subject is no longer available.');setSelectedSubjectId(String(draft.subjectId));if(selectedExamId===String(draft.examId)){setMarkDrafts(current=>({...current,...Object.fromEntries(draft.records.map((row:any)=>[String(row.student_id)+':'+String(draft.subjectId),String(row.score)]))}))}else{setPendingOfflineMarkDraft(draft);setSelectedExamId(String(draft.examId))}setOfflineMarkMessage('Encrypted marks draft unlocked. Review scores before submitting.')}catch(error){setOfflineMarkMessage(error instanceof Error?error.message:'Unable to unlock the marks draft.')}finally{setOfflineMarkBusy(false)}}

  async function clearOfflineMarkDraft(){const deviceId=localStorage.getItem('schoolbridge-sync-device-'+userId)||'';if(!deviceId)return;if(!window.confirm('Clear the encrypted offline marks draft saved on this browser?'))return;setOfflineMarkBusy(true);try{await deleteEncryptedOfflineDraft(userId,deviceId);setOfflineMarkMessage('Saved offline marks draft cleared.')}catch(error){setOfflineMarkMessage(error instanceof Error?error.message:'Unable to clear the saved marks draft.')}finally{setOfflineMarkBusy(false)}}

  async function submitOfflineMarkDraft(){const deviceId=localStorage.getItem('schoolbridge-sync-device-'+userId)||'';if(!deviceId||offlinePassphrase.length<12){setOfflineMarkMessage('Register this device and enter the offline passphrase.');return}setOfflineMarkBusy(true);try{const draft=await loadEncryptedOfflineDraft<any>(userId,deviceId,offlinePassphrase);if(draft.version!==1||draft.userId!==userId||draft.deviceId!==deviceId||draft.expiresAt<=Date.now())throw new Error('This marks draft is expired or belongs to another account or device.');const result=await request<{proposal_id:number;status:string;applied:boolean;saved:number}>('sync/teacher-mark-proposals',token,{method:'POST',body:JSON.stringify({device_id:deviceId,idempotency_key:draft.idempotencyKey,exam_id:draft.examId,subject_id:draft.subjectId,base_sequence:draft.baseSequence,base_mark_ids:draft.baseMarkIds,records:draft.records})});if(result.applied){await deleteEncryptedOfflineDraft(userId,deviceId);setOfflineMarkMessage(result.saved+' marks synchronised as unverified results; normal verification still applies.');if(selectedExamId===String(draft.examId)){const next=await request<Mark[]>('marks?exam_id='+draft.examId,token);setMarks(next);setMarkDrafts(Object.fromEntries(next.map(mark=>[String(mark.student_id)+':'+String(mark.subject_id),String(Math.round(mark.score))])))}const history=await request<{proposals:typeof offlineMarkHistory}>('sync/teacher-mark-proposals/mine',token);setOfflineMarkHistory(history.proposals||[])}else{setOfflineMarkMessage('Submission #'+result.proposal_id+' was not applied because a conflict was detected. The encrypted draft is retained.');const history=await request<{proposals:typeof offlineMarkHistory}>('sync/teacher-mark-proposals/mine',token);setOfflineMarkHistory(history.proposals||[])}}catch(error){setOfflineMarkMessage(error instanceof Error?error.message:'Unable to submit offline marks. The encrypted draft remains saved.')}finally{setOfflineMarkBusy(false)}}

  async function setSubjectVerification(subjectId: number, verified: boolean) {
    if (!selectedExam) { setError('Choose an examination first.'); return }
    if (selectedExam.status !== 'draft') { setError('This examination is closed. Result verification can no longer be changed.'); return }
    const subject = subjects.find(row => row.id === subjectId)
    const action = verified ? 'verify and lock' : 'unlock for correction'
    if (!window.confirm(`Are you sure you want to ${action} every recorded ${subject?.name || 'subject'} score for this examination?`)) return
    setSaving(true); setError(''); setMessage('')
    try {
      const params = new URLSearchParams({ exam_id: String(selectedExam.id), subject_id: String(subjectId), verified: String(verified) })
      const result = await request<{records:number;changed:number}>(`subjects/${subjectId}/marks/verification?${params.toString()}`, token, { method: 'PATCH' })
      const next = await request<Mark[]>(`marks?exam_id=${selectedExam.id}`, token)
      setMarks(next)
      setMessage((verified ? 'All ' : 'All ') + result.records + ' recorded ' + (subject?.name || 'subject') + ' scores ' + (verified ? 'verified and locked.' : 'unlocked for correction.') )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to update subject score verification.')
    } finally { setSaving(false) }
  }

  async function verifyAllExamResults() {
    if (!selectedExam) { setError('Choose an examination first.'); return }
    if (selectedExam.status !== 'draft') { setError('This examination is closed. Result verification can no longer be changed.'); return }
    const pending = marks.filter(mark => !mark.verified).length
    if (!pending) { setMessage('There are no submitted results awaiting verification.'); return }
    if (!window.confirm(`Verify and lock all ${pending} submitted scores for ${selectedExam.name}?`)) return
    setSaving(true); setError(''); setMessage('')
    try {
      const result = await request<{records:number;changed:number}>(`exams/${selectedExam.id}/results/verification?verified=true`, token, { method: 'PATCH' })
      const next = await request<Mark[]>(`marks?exam_id=${selectedExam.id}`, token)
      setMarks(next)
      setMessage(`Verified and locked all ${result.records} submitted results for ${selectedExam.name}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to verify examination results.')
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

  async function persistReportBranding(logo: string, config: ReportTemplateConfig) {
    await request('settings/school-profile', token, { method: 'PUT', body: JSON.stringify({ name: schoolProfile.name || 'My School', address: schoolProfile.address || null, phone: schoolProfile.phone || null, email: schoolProfile.email || null, motto: schoolProfile.motto || null, school_type: schoolProfile.school_type || 'Secondary', a_level_combinations: schoolProfile.a_level_combinations || null, o_level_optional_subjects: schoolProfile.o_level_optional_subjects || null, a_level_subsidiary_subjects: schoolProfile.a_level_subsidiary_subjects || null, report_logo: logo || null, report_template: JSON.stringify(config) }) })
    localStorage.setItem('schoolbridge-report-logo', logo)
    localStorage.setItem('schoolbridge-report-template', JSON.stringify(config))
  }
  async function saveReportTemplateEdits() {
    const next = { ...reportTemplateConfig, title: reportTitle.trim(), footer: reportFooter.trim() }
    setSaving(true); setError('')
    try { await persistReportBranding(reportLogo, next); setReportTemplateConfig(next); setMessage('Report design saved to the school database.') }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to save report design.') }
    finally { setSaving(false) }
  }
  async function uploadReportTemplate(file?: File) {
    if (!file) return
    if (file.size > 100 * 1024) { setError('Report template JSON must be 100 KB or smaller.'); return }
    try {
      const parsed = JSON.parse(await file.text())
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || (parsed.title !== undefined && typeof parsed.title !== 'string') || (parsed.footer !== undefined && typeof parsed.footer !== 'string')) throw new Error('Use a JSON template with optional title and footer text fields.')
      const next = { title: parsed.title || reportTitle, footer: parsed.footer || reportFooter }
      await persistReportBranding(reportLogo, next); setReportTemplateConfig(next); setReportTitle(next.title); setReportFooter(next.footer); setMessage('Custom report template imported and saved to the school database.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to read this report template.') }
  }
  function printAcademicSection(target: 'results' | 'report' | 'class-reports') {
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

  function reportCardMarkup(student: Student, rows: typeof historyRows, index?: number) {
    const average = rows.length ? rows.reduce((sum, mark) => sum + mark.score, 0) / rows.length : 0
    const overallGrade = gradingBands.find(band => average >= band.min_score && (average < band.max_score || band.max_score === 100))?.grade || '—'
    const templateClass = 'report-card-sheet report-template-' + reportTemplate
    return <article className={templateClass} key={student.id}>
      <header className="report-card-header">
        {reportLogo ? <img className="report-school-emblem report-school-logo" src={reportLogo} alt="School badge"/> : <div className="report-school-emblem">{schoolProfile.name?.slice(0, 2).toUpperCase() || 'SB'}</div>}
        <div className="report-school-title"><span>OFFICIAL ACADEMIC RECORD {index !== undefined ? '· CLASS COPY ' + (index + 1) : ''}</span><h2>{schoolProfile.name || 'SCHOOL NAME'}</h2><p>{[schoolProfile.address, schoolProfile.phone, schoolProfile.email].filter(Boolean).join(' · ') || 'School address · Telephone · Email'}</p>{schoolProfile.motto && <em>{schoolProfile.motto}</em>}<strong>{reportTitle || (reportTemplate === 'classic' ? 'STUDENT REPORT CARD' : reportTemplate === 'detailed' ? 'COMPREHENSIVE ACADEMIC REPORT' : 'STUDENT PROGRESS REPORT')}</strong></div>
        <div className="report-card-term"><span>ACADEMIC YEAR</span><strong>{selectedExam?.year || new Date().getFullYear()}</strong><span>TERM</span><strong>{selectedExam?.term || '—'}</strong></div>
      </header>
      <div className="report-student-details">
        <div><small>STUDENT NAME</small><strong>{studentName(student)}</strong></div><div><small>ADMISSION NUMBER</small><strong>{student.admission_number}</strong></div>
        <div><small>CLASS</small><strong>{selectedClass?.name || '—'} {selectedClass?.section || ''}</strong></div><div><small>EXAMINATION</small><strong>{selectedExam?.name || 'Academic record'}</strong></div>
      </div>
      <div className="report-section-heading"><span>01</span><h3>Academic performance</h3></div>
      <div className="table-wrap report-results-table"><table><thead><tr><th>SUBJECT</th><th>SCORE / 100</th><th>GRADE</th><th>TEACHER'S SUBJECT REMARK</th></tr></thead><tbody>
        {rows.map(mark => <tr key={mark.id}><td><strong>{mark.subject?.name || 'Unknown subject'}</strong></td><td>{Math.round(mark.score)}</td><td><strong>{mark.grade}</strong></td><td>{gradingBands.find(band => band.grade === mark.grade)?.remark || '—'}</td></tr>)}
        {!rows.length && <tr><td colSpan={4}>No verified subject results are available for this examination.</td></tr>}
      </tbody></table></div>
      <div className="report-summary-grid"><div><small>SUBJECTS GRADED</small><strong>{rows.length}</strong></div><div><small>AVERAGE SCORE</small><strong>{Math.round(average)}%</strong></div><div><small>OVERALL GRADE</small><strong>{overallGrade}</strong></div></div>
      {reportTemplate === 'detailed' && <div className="report-section-heading"><span>02</span><h3>Academic guidance</h3></div>}
      <div className="report-section-heading"><span>{reportTemplate === 'detailed' ? '03' : '02'}</span><h3>Progress remarks and recommendations</h3></div>
      <div className="report-remarks-grid"><label>Class teacher's remarks<textarea value={reportRemarks.classTeacher} onChange={e => setReportRemarks(v => ({ ...v, classTeacher: e.target.value }))} placeholder="Comment on attendance, conduct, participation and general progress."/></label><label>Headteacher's remarks<textarea value={reportRemarks.headteacher} onChange={e => setReportRemarks(v => ({ ...v, headteacher: e.target.value }))} placeholder="School leadership comments and recommendations."/></label></div>
      <div className="report-signatures"><div><strong>Class teacher</strong><span>Signature: __________________</span><span>Date: __________________</span></div><div><strong>Headteacher</strong><span>Signature: __________________</span><span>Date: __________________</span></div></div>
      <footer className="report-card-footer">{reportFooter}</footer>
    </article>
  }

  const selectedReportRows = historyRows.filter(mark => !selectedExam || mark.exam_id === selectedExam.id)
  const classReportStudents = [...students].sort((a, b) => studentName(a).localeCompare(studentName(b)))
  const classReportData = classReportStudents.map(student => ({
    student,
    rows: marks.filter(mark => mark.student_id === student.id && mark.verified).map(mark => ({
      ...mark,
      exam: selectedExam || undefined,
      subject: subjects.find(subject => subject.id === mark.subject_id),
      grade: gradingBands.find(band => mark.score >= band.min_score && (mark.score < band.max_score || band.max_score === 100))?.grade || '—',
    })),
  }))

  return <div className="academic-workspace">
    <section className="panel">
      <div className="panel-heading">
        <div><h2>Examinations and results</h2><p>Set up class examinations, enter and correct marks, and review class performance.</p></div>
        <button type="button" className="secondary-button" onClick={() => void loadSetup()} disabled={loading || saving}><RefreshCw size={15}/> Refresh</button>
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
      {message && <div className="success-notice" role="status">{message}</div>}
      <div className="exam-selection-flow">
        <div className="exam-flow-step"><span className="form-section-number">01</span><div><strong>Choose exam type</strong><small>Filter the examination list by category.</small></div></div>
        <nav className="exam-type-tabs" aria-label="Examination types">
          {['All exams', ...EXAM_TYPES].map(type => <button type="button" key={type} className={activeExamType === type ? 'exam-type-tab active' : 'exam-type-tab'} onClick={() => { setActiveExamType(type); setSelectedExamGroupKey(''); setSelectedExamId('') }}>{type}</button>)}
        </nav>
        <div className="exam-flow-step"><span className="form-section-number">02</span><div><strong>Choose examination</strong><small>Select the exam name, term and academic year.</small></div></div>
        <div className="exam-choice-grid">
          {Array.from(new Map(exams.filter(exam => activeExamType === 'All exams' || (exam.exam_type || 'Other') === activeExamType).map(exam => [examGroupKey(exam), exam])).values()).map(exam => {
            const key = examGroupKey(exam)
            return <button type="button" key={key} className={selectedExamGroupKey === key ? 'exam-choice active' : 'exam-choice'} onClick={() => { setSelectedExamGroupKey(key); setSelectedExamId('') }}>
              <strong>{exam.exam_type || 'Other'}</strong><span>{exam.term} · {exam.year}</span><small>{exams.filter(row => examGroupKey(row) === key).length} class(es)</small>
            </button>
          })}
          {!exams.some(exam => activeExamType === 'All exams' || (exam.exam_type || 'Other') === activeExamType) && <p className="form-hint">No examinations have been created under this type yet.</p>}
        </div>
        {selectedExamGroupKey && <><div className="exam-flow-step"><span className="form-section-number">03</span><div><strong>Choose class</strong><small>Open the examination for the class you want to work with.</small></div></div>
          <div className="exam-class-choices">{exams.filter(exam => examGroupKey(exam) === selectedExamGroupKey).map(exam => {
            const item = classes.find(row => row.id === exam.class_id)
            return <button type="button" key={exam.id} className={selectedExamId === String(exam.id) ? 'exam-class-choice active' : 'exam-class-choice'} onClick={() => setSelectedExamId(String(exam.id))}>{item?.name || 'Unassigned class'}{item?.section ? ' · ' + item.section : ''}</button>
          })}</div>
        </>}
        <button type="button" className="primary-button" onClick={() => setShowExamForm(value => !value)}><Plus size={16}/>{showExamForm ? 'Close form' : 'Create examination'}</button>
      </div>
      {showExamForm && <form className="student-form registration-form exam-create-form" onSubmit={createExam}>
        <div className="form-section">
          <div className="form-section-heading"><span className="form-section-number">01</span><div><h3>Create examination</h3><p>Choose the examination type and term. The selected type becomes the examination category; term and year distinguish each sitting.</p></div></div>
          
          <div className="exam-create-meta">
            <div><strong>Exam type</strong><div className="exam-pill-options">{EXAM_TYPES.map(type => <button type="button" key={type} className={examForm.exam_type === type ? 'exam-pill active' : 'exam-pill'} onClick={() => setExamForm({ ...examForm, exam_type: type })}>{type}</button>)}</div></div>
            <div><strong>Term</strong><div className="exam-pill-options">{['Term 1','Term 2','Term 3'].map(term => <button type="button" key={term} className={examForm.term === term ? 'exam-pill active' : 'exam-pill'} onClick={() => setExamForm({ ...examForm, term })}>{term}</button>)}</div></div>
            <label>Academic year *<input required type="number" min="2000" max="2100" value={examForm.year} onChange={e => setExamForm({ ...examForm, year: e.target.value })}/></label>
          </div>
          <div className="exam-class-picker"><div><strong>Input classes *</strong><small>{examForm.class_ids.length} selected · one examination record will be created for each selected class.</small></div>
            <div className="exam-class-choices">{classes.map(item => { const id = item.id; const chosen = examForm.class_ids.includes(id); return <button type="button" key={id} className={chosen ? 'exam-class-choice active' : 'exam-class-choice'} onClick={() => setExamForm(old => ({ ...old, class_ids: chosen ? old.class_ids.filter(value => value !== id) : [...old.class_ids, id] }))}>{item.name}{item.section ? ' · ' + item.section : ''}</button> })}</div>
          </div>
        </div>
        <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setShowExamForm(false)}>Cancel</button><button className="primary-button" disabled={saving || !classes.length || !examForm.class_ids.length}>{saving ? 'Saving...' : 'Create examination'}</button></div>
      </form>}
    </section>

    {selectedExam && <>
      <section className="panel">
        <div className="panel-heading"><div><h2>{selectedExam.exam_type || selectedExam.name}</h2><p>{selectedClass?.name || 'Class'}{selectedClass?.section ? ' — ' + selectedClass.section : ''} · {selectedExam.term} {selectedExam.year}</p><span className={'exam-lifecycle-status exam-lifecycle-' + selectedExam.status}>Status: {selectedExam.status === 'draft' ? 'Open for entry' : selectedExam.status === 'closed' ? 'Closed · Locked' : 'Published to parents'}</span></div><div className="dashboard-heading-actions">{isAdmin && selectedExam.status === 'draft' && <button type="button" className="secondary-button" disabled={saving} onClick={() => void changeExamLifecycle('close')}>Close & finalise</button>}{isAdmin && selectedExam.status === 'closed' && <button type="button" className="primary-button" disabled={saving} onClick={() => void changeExamLifecycle('publish')}>Publish results to parents</button>}</div></div>
        {selectedExam.status !== 'draft' && <p className="form-hint" role="status">{selectedExam.status === 'closed' ? 'This examination is closed. Results are locked and are not yet visible to parents.' : 'This examination is published. Linked parents can view verified results; marks remain locked.'}</p>}
        <div className="stats-grid finance-stats">
          <div className="stat-card"><span>Students in class</span><strong className="stat-value">{students.length}</strong></div>
          <div className="stat-card"><span>Marks recorded</span><strong className="stat-value">{marks.length}</strong></div>
          <div className="stat-card"><span>Subjects assessed</span><strong className="stat-value">{subjectAnalysis.length}</strong></div>
          <div className="stat-card"><span>Students with results</span><strong className="stat-value">{results.length}</strong></div>
          <div className="stat-card"><span>Verified marks</span><strong className="stat-value">{marks.filter(mark => mark.verified).length} / {marks.length}</strong></div>
        </div>
      </section>
      <nav className="academic-tabs" aria-label="Academic workspace tabs">{([["marks", "Marks entry"], ["submitted", "Submitted results"], ["results", "Class performance"], ["grading", "Grading scale"], ["history", "Report cards"]] as const).map(([key, label]) => <button key={key} type="button" className={activeAcademicTab === key ? "academic-tab active" : "academic-tab"} aria-current={activeAcademicTab === key ? "page" : undefined} onClick={() => setActiveAcademicTab(key)}>{label}{key === 'submitted' && marks.filter(mark => !mark.verified).length > 0 ? <span className="academic-tab-count">{marks.filter(mark => !mark.verified).length}</span> : null}</button>)}</nav>


      {activeAcademicTab === 'marks' && (
      <section className="panel subject-marks-workspace">
        <div className="panel-heading"><div><h2>Enter subject marks</h2><p>Select the subject you teach, then enter scores beside each student. Only the selected subject is shown.</p></div></div>
        {saving && activeAcademicTab === 'marks' && <div className="teacher-results-progress" role="status"><div><strong>Submitting {subjects.find(item => String(item.id) === selectedSubjectId)?.name || 'subject'} results</strong><span>{saveProgress}% complete · {eligibleStudents.length} students</span></div><div className="teacher-results-progress-track"><span style={{ width: saveProgress + '%' }} /></div></div>}
        <div className="subject-marks-toolbar">
          <div className="academic-exam-select"><strong>Subject to enter</strong><div className="exam-pill-options subject-choice-options">{subjects.map(subject => <button type="button" key={subject.id} className={String(subject.id) === selectedSubjectId ? 'exam-pill active' : 'exam-pill'} onClick={() => setSelectedSubjectId(String(subject.id))}>{subject.name}</button>)}</div></div>
          <div className="subject-marks-count"><strong>{selectedSubjectId ? eligibleStudents.length : students.length}</strong><span>{selectedSubjectId ? 'students offering this subject' : 'students in this class'}</span></div>
          <button type="button" className="primary-button" onClick={() => void saveClassMarks()} disabled={saving || !eligibleStudents.length || !selectedSubjectId || selectedExam.status !== 'draft'}><Save size={15}/>{saving ? 'Submitting…' : 'Submit class results'}</button>
        </div>
        {!students.length && <p className="form-hint">No students are registered in this class yet.</p>}
        {!subjects.length && <p className="form-hint">No subjects are configured for this school type.</p>}
        {!!students.length && !selectedSubjectId && <div className="subject-marks-empty"><BookOpen size={25}/><strong>Choose a subject to begin</strong><span>The student list and score boxes will appear here. Submit the subject once all scores are ready; blank scores are recorded as No score (0).</span></div>}
        {!!students.length && !!selectedSubjectId && !eligibleStudents.length && <div className="subject-marks-empty"><BookOpen size={25}/><strong>No students offer this subject</strong><span>Check each A-Level student's combination and subsidiary/optional subjects.</span></div>}
        {isTeacher && <div className="offline-attendance-tools"><h3>Offline marks</h3><p className="form-hint">{offlineConnectionOnline ? 'Connected. Drafts are encrypted on this device and checked by the server before synchronisation.' : 'Offline. You can save an encrypted draft; it will not change official results until you reconnect and submit.'} When reconnected, SchoolBridge rechecks your device, current assignment, permissions, student eligibility, verification locks and record conflicts. Valid marks remain unverified.</p><input type="password" autoComplete="new-password" value={offlinePassphrase} onChange={event=>setOfflinePassphrase(event.target.value)} placeholder="Offline passphrase (12+ characters)"/><div className="form-actions"><button className="secondary-button" type="button" disabled={offlineMarkBusy||saving} onClick={()=>void saveOfflineMarkDraft()}><LockKeyhole size={15}/> Save encrypted draft</button><button className="secondary-button" type="button" disabled={offlineMarkBusy} onClick={()=>void unlockOfflineMarkDraft()}><Download size={15}/> Unlock draft</button><button className="primary-button" type="button" disabled={offlineMarkBusy} onClick={()=>void submitOfflineMarkDraft()}><Upload size={15}/> Submit when connected</button><button className="secondary-button" type="button" disabled={offlineMarkBusy} onClick={()=>void clearOfflineMarkDraft()}>Clear saved draft</button></div>{offlineMarkMessage&&<p className="form-hint" role="status">{offlineMarkMessage}</p>}{offlineMarkHistory.length>0&&<div className="recorded-marks-details"><h4>Offline submission history</h4><div className="table-wrap"><table><thead><tr><th>Examination</th><th>Subject</th><th>Records</th><th>Status</th><th>Submitted</th></tr></thead><tbody>{offlineMarkHistory.map(item=><tr key={item.id}><td>{item.exam_name} · {item.term} {item.year||''}</td><td>{item.subject_name}</td><td>{item.record_count}</td><td>{item.status==='applied'?'Synchronised · Unverified':item.status==='conflict'?'Conflict · Review required':item.status}</td><td>{item.submitted_at?new Date(item.submitted_at).toLocaleString():'—'}</td></tr>)}</tbody></table></div></div>}</div>}
        {!!students.length && !!selectedSubjectId && !!eligibleStudents.length && <div className="student-score-list">
          <div className="student-score-list-heading"><span>STUDENT</span><span>ADMISSION NUMBER</span><span>SCORE / 100</span><span>STATUS</span></div>
          {eligibleStudents.map((student, index) => {
            const mark = marks.find(row => row.student_id === student.id && String(row.subject_id) === selectedSubjectId)
            const key = String(student.id) + ':' + selectedSubjectId
            return <div className="student-score-row" key={student.id}>
              <div className="student-score-name"><span className="student-score-number">{index + 1}</span><strong>{studentName(student)}</strong></div>
              <span className="student-score-admission">{student.admission_number}</span>
              <input className="student-score-input" aria-label={studentName(student) + ' score'} type="number" min="0" max="100" step="1" inputMode="numeric" placeholder="Enter score" value={markDrafts[key] ?? ''} disabled={!!mark?.verified || saving || selectedExam.status !== 'draft'} onChange={event => setMarkDrafts(current => ({ ...current, [key]: event.target.value }))}/>
              <span className={mark?.verified ? 'student-score-status verified' : mark ? 'student-score-status recorded' : 'student-score-status pending'}>{mark?.verified ? 'Verified' : mark ? 'Submitted · Not verified' : 'Not submitted'}</span>
            </div>
          })}
          <div className="student-score-footer"><span>Blank scores are submitted as No score (0). Scores must be between 0 and 100.</span><button type="button" className="primary-button" onClick={() => void saveClassMarks()} disabled={saving || !eligibleStudents.length || selectedExam.status !== 'draft'}><Save size={15}/>{saving ? 'Submitting…' : 'Submit class results'}</button></div>
        </div>}
        <details className="recorded-marks-details"><summary>Recorded scores · by subject and verification status</summary>
          <div className="recorded-marks-filters"><div><strong>Subject</strong><div className="exam-pill-options">{['all', ...subjects.map(subject => String(subject.id))].map(id => <button type="button" key={id} className={recordedSubjectFilter === id ? 'exam-pill active' : 'exam-pill'} onClick={() => setRecordedSubjectFilter(id)}>{id === 'all' ? 'All subjects' : subjects.find(subject => String(subject.id) === id)?.name}</button>)}</div></div><div><strong>Verification status</strong><div className="exam-pill-options">{(['all','verified','unverified'] as const).map(status => <button type="button" key={status} className={recordedStatusFilter === status ? 'exam-pill active' : 'exam-pill'} onClick={() => setRecordedStatusFilter(status)}>{status === 'all' ? 'All statuses' : status === 'verified' ? 'Verified' : 'Submitted · Not verified'}</button>)}</div></div></div>
          <div className="recorded-subject-groups">
            {subjects.filter(subject => marks.some(mark => mark.subject_id === subject.id) && (recordedSubjectFilter === 'all' || String(subject.id) === recordedSubjectFilter)).map(subject => {
              const subjectMarks = marks.filter(mark => mark.subject_id === subject.id && students.some(student => student.id === mark.student_id && studentOffersSubject(student, subject)) && (recordedStatusFilter === 'all' || (recordedStatusFilter === 'verified' ? mark.verified : !mark.verified))).sort((a, b) => studentName(studentById.get(a.student_id)).localeCompare(studentName(studentById.get(b.student_id))));
              const verifiedMarks = subjectMarks.filter(mark => mark.verified);
              const unverifiedMarks = subjectMarks.filter(mark => !mark.verified);
              const renderMarkRows = (rows: Mark[]) => rows.map(mark => <tr key={mark.id}><td>{studentName(studentById.get(mark.student_id))}</td><td><strong>{Math.round(mark.score)}</strong></td></tr>);
              return <section className="recorded-subject-card" key={subject.id}>
                <div className="recorded-subject-heading"><h3>{subject.name}</h3><span>{subjectMarks.length} recorded</span></div>
                <div className="recorded-status-columns">
                  <div className="recorded-status-group">
                    <div className="recorded-status-heading"><strong>Verified scores</strong><span className="recorded-count verified-count">{verifiedMarks.length}</span></div>
                    {verifiedMarks.length>0&&<button type="button" className="secondary-button subject-verification-action" disabled={saving} onClick={()=>void setSubjectVerification(subject.id,false)}>Unlock all {subject.name} scores</button>}
                    <div className="table-wrap"><table><thead><tr><th>Student</th><th>Score</th></tr></thead><tbody>{renderMarkRows(verifiedMarks)}{!verifiedMarks.length && <tr><td colSpan={2}>No verified scores.</td></tr>}</tbody></table></div>
                  </div>
                  <div className="recorded-status-group">
                    <div className="recorded-status-heading"><strong>Unverified scores</strong><span className="recorded-count pending-count">{unverifiedMarks.length}</span></div>
                    {unverifiedMarks.length>0&&<button type="button" className="primary-button subject-verification-action" disabled={saving} onClick={()=>void setSubjectVerification(subject.id,true)}>Verify all {subject.name} scores</button>}
                    <div className="table-wrap"><table><thead><tr><th>Student</th><th>Score</th></tr></thead><tbody>{renderMarkRows(unverifiedMarks)}{!unverifiedMarks.length && <tr><td colSpan={2}>No unverified scores.</td></tr>}</tbody></table></div>
                  </div>
                </div>
              </section>;
            })}
            {!marks.length && <p className="form-hint">No marks have been recorded for this examination yet.</p>}
          </div>
        </details>
      </section>
      )}

      {activeAcademicTab === 'submitted' && (
        <section className="panel submitted-results-workspace">
          <div className="panel-heading">
            <div><h2>Submitted results</h2><p>Results are grouped by subject. Select a subject tab to review each learner and see whether results are Submitted · Not verified or Verified.</p></div>
            <div className="dashboard-heading-actions"><span className="count-pill">{marks.filter(mark => !mark.verified).length} not verified</span>{canVerify && marks.some(mark => !mark.verified) && <button type="button" className="primary-button" disabled={saving} onClick={() => void verifyAllExamResults()}>Verify all submitted results</button>}</div>
          </div>
          {!selectedExam && <p className="form-hint">Select an examination to review submitted results.</p>}
          {selectedExam && <>
            <div className="submitted-subject-tabs" role="tablist" aria-label="Submitted results by subject">
              {subjects.filter(subject => marks.some(mark => mark.subject_id === subject.id && students.some(student => student.id === mark.student_id && studentOffersSubject(student, subject)))).map(subject => {
                const subjectMarks = marks.filter(mark => mark.subject_id === subject.id && students.some(student => student.id === mark.student_id && studentOffersSubject(student, subject)))
                const verifiedCount = subjectMarks.filter(mark => mark.verified).length
                const pendingCount = subjectMarks.length - verifiedCount
                const activeId = (subjects.some(row => String(row.id) === submittedSubjectId && marks.some(mark => mark.subject_id === row.id)) ? submittedSubjectId : String(subjects.find(row => marks.some(mark => mark.subject_id === row.id))?.id || ''))
                return <button type="button" role="tab" aria-selected={String(subject.id) === activeId} className={String(subject.id) === activeId ? 'submitted-subject-tab active' : 'submitted-subject-tab'} key={subject.id} onClick={() => setSubmittedSubjectId(String(subject.id))}>
                  <strong>{subject.name}</strong><span>{subjectMarks.length} submitted</span><small>{verifiedCount} verified · {pendingCount} not verified</small>
                </button>
              })}
            </div>
            {(() => {
              const subject = subjects.find(row => String(row.id) === submittedSubjectId && marks.some(mark => mark.subject_id === row.id)) || subjects.find(row => marks.some(mark => mark.subject_id === row.id))
              if (!subject) return <p className="empty-state">No subject results have been submitted for this examination yet.</p>
              const subjectMarks = marks.filter(mark => mark.subject_id === subject.id && students.some(student => student.id === mark.student_id && studentOffersSubject(student, subject))).sort((a,b) => studentName(studentById.get(a.student_id)).localeCompare(studentName(studentById.get(b.student_id))))
              const pendingCount = subjectMarks.filter(mark => !mark.verified).length
              return <section className="recorded-subject-card" key={subject.id}>
                <div className="recorded-subject-heading"><div><h3>{subject.name}</h3><span>{selectedClass?.name || 'Class'} · {selectedExam.name} · {selectedExam.term} {selectedExam.year}</span></div><span className="recorded-count">{subjectMarks.length} submitted</span></div>
                <div className="table-wrap"><table><thead><tr><th>Student</th><th>Admission number</th><th>Submitted score</th><th>Status</th></tr></thead><tbody>
                  {subjectMarks.map(mark => <tr key={mark.id}><td>{studentName(studentById.get(mark.student_id))}</td><td>{studentById.get(mark.student_id)?.admission_number || '—'}</td><td><strong>{mark.score === 0 ? 'No score (0)' : Math.round(mark.score)}</strong></td><td><span className={mark.verified ? 'student-score-status verified' : 'student-score-status recorded'}>{mark.verified ? 'Verified' : 'Submitted · Not verified'}</span></td></tr>)}
                  {!subjectMarks.length && <tr><td colSpan={4}>No submitted scores for this subject.</td></tr>}
                </tbody></table></div>
                {pendingCount > 0 ? <div className="form-actions"><button type="button" className="secondary-button" onClick={() => { setSelectedSubjectId(String(subject.id)); setActiveAcademicTab('marks') }}>Review & edit {subject.name} results</button>{canVerify && <button type="button" className="primary-button subject-verification-action" disabled={saving} onClick={() => void setSubjectVerification(subject.id, true)}>Verify all {subject.name} results</button>}{!canVerify && <span className="form-hint">An authorised academic officer must verify these results.</span>}</div> : <p className="success-notice">All submitted {subject.name} results are verified.</p>}
              </section>
            })()}
          </>}
        </section>
      )}

      {activeAcademicTab === 'results' && (
      <section className="panel academic-results-print">
        <div className="panel-heading report-screen-controls"><div><h2>Class performance</h2><p>{selectedExam.name} · {selectedClass?.name || 'Class'}{selectedClass?.section ? ' — ' + selectedClass.section : ''} · {selectedExam.term} {selectedExam.year}</p><p>Provisional ranking uses average scores. Complete and verify all subject marks before issuing final results.</p></div><button type="button" className="secondary-button" onClick={() => printAcademicSection('results')}><Printer size={15}/> Print class performance</button></div>
        <div className="class-results-print-sheet">
          <header className="class-results-print-header"><div><span>OFFICIAL ACADEMIC RESULTS</span><h1>{schoolProfile.name || 'SCHOOL NAME'}</h1><p>{[schoolProfile.address, schoolProfile.phone, schoolProfile.email].filter(Boolean).join(' · ')}</p></div><strong>CLASS RESULTS</strong></header>
          <div className="class-results-print-meta"><span><b>CLASS</b>{selectedClass?.name || '—'} {selectedClass?.section || ''}</span><span><b>EXAMINATION</b>{selectedExam.name}</span><span><b>TERM / YEAR</b>{selectedExam.term} {selectedExam.year}</span><span><b>ENROLMENT</b>{students.length} students</span></div>
          <div className="class-results-print-stats"><div><small>RESULTS RECORDED</small><strong>{verifiedResults.length}</strong></div><div><small>SUBJECTS ASSESSED</small><strong>{verifiedSubjectAnalysis.length}</strong></div><div><small>VERIFIED SCORES</small><strong>{marks.filter(mark => mark.verified).length} / {marks.length}</strong></div><div><small>CLASS AVERAGE</small><strong>{Math.round(verifiedResults.length ? verifiedResults.reduce((sum, row) => sum + row.average, 0) / verifiedResults.length : 0)}%</strong></div></div>
          <h2>Class performance register</h2>
          <div className="table-wrap"><table><thead><tr><th>POS.</th><th>STUDENT NAME</th><th>ADMISSION NO.</th>{verifiedSubjectAnalysis.map(row => <th key={row.subject.id}>{row.subject.name}</th>)}<th>TOTAL</th><th>AVERAGE</th><th>GRADE</th></tr></thead><tbody>
            {verifiedResults.map(result => <tr key={result.studentId}><td>{result.position}</td><td>{studentName(studentById.get(result.studentId))}</td><td>{studentById.get(result.studentId)?.admission_number || '—'}</td>{verifiedSubjectAnalysis.map(row => { const mark = verifiedMarks.find(item => item.student_id === result.studentId && item.subject_id === row.subject.id); return <td key={row.subject.id}>{mark ? Math.round(mark.score) : '—'}</td> })}<td>{Math.round(result.total)}</td><td>{Math.round(result.average)}%</td><td>{result.grade}</td></tr>)}
            {!verifiedResults.length && <tr><td colSpan={verifiedSubjectAnalysis.length + 6}>No verified results recorded yet.</td></tr>}
          </tbody></table></div>
          <h2>Subject performance summary</h2><div className="table-wrap"><table><thead><tr><th>SUBJECT</th><th>STUDENTS ASSESSED</th><th>CLASS AVERAGE</th></tr></thead><tbody>{verifiedSubjectAnalysis.map(row => <tr key={row.subject.id}><td>{row.subject.name}</td><td>{row.count}</td><td>{Math.round(row.average)}%</td></tr>)}</tbody></table></div>
          <footer>Prepared by SchoolBridge · Verified results only should be treated as official · Headteacher signature: ____________________</footer>
        </div>
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
        <div className="panel-heading report-screen-controls"><div><h2>Report cards</h2><p>Select a design, preview an individual student's report, or print reports for the entire class in one batch.</p></div><button type="button" className="secondary-button" disabled={!classReportData.length} onClick={() => printAcademicSection('class-reports')}><Printer size={15}/> Print whole class ({classReportData.length})</button></div>
        <div className="report-template-toolbar report-screen-controls">
          <label>Report template<select value={reportTemplate} onChange={e => setReportTemplate(e.target.value as 'classic' | 'modern' | 'detailed')}><option value="modern">Modern professional</option><option value="classic">Classic school report</option><option value="detailed">Detailed academic report</option></select></label>
          <label className="academic-exam-select report-student-picker">Preview student<select value={historyStudentId} onChange={e => setHistoryStudentId(e.target.value)}><option value="">Choose a student</option>{students.map(student => <option key={student.id} value={student.id}>{studentName(student)} · {student.admission_number}</option>)}</select></label>
          <button type="button" className="primary-button" disabled={!historyStudentId} onClick={() => printAcademicSection('report')}><Printer size={15}/> Print selected report</button>
        </div>
        <div className="report-customisation-panel report-screen-controls"><div><strong>Upload a report template</strong><p>Import a JSON template with editable report heading and footer fields.</p><input type="file" accept=".json,application/json" onChange={e => void uploadReportTemplate(e.target.files?.[0])}/></div><label>Editable report heading<input value={reportTitle} maxLength={100} onChange={e => setReportTitle(e.target.value)}/></label><label>Editable report footer<input value={reportFooter} maxLength={180} onChange={e => setReportFooter(e.target.value)}/></label><button type="button" className="primary-button" onClick={saveReportTemplateEdits}>Save report design</button></div>
        {historyError && <div className="form-error" role="alert">{historyError}</div>}
        {historyStudent && reportCardMarkup(historyStudent, selectedReportRows)}
        {!historyStudent && <div className="subject-marks-empty"><BookOpen size={25}/><strong>Choose a student to preview a report</strong><span>Use Print whole class to produce every student's report in one print job.</span></div>}
        <div className="class-reports-print-batch">
          {classReportData.map(({student, rows}, index) => reportCardMarkup(student, rows, index))}
        </div>
      </section>
      )}

    </>}
    {!selectedExam && !loading && <section className="panel empty-state"><BookOpen size={32}/><h3>No examination selected</h3><p>Create an examination for a class to begin recording results.</p></section>}
  </div>
}
