import { useEffect, useState } from 'react'
import { MessageSquareText, Send, PlusCircle, GraduationCap, CheckCheck, LockKeyhole, Unlock } from 'lucide-react'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
async function api<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/api/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.detail || `Request failed: ${response.status}`)
  return result as T
}
type Recipient = { student_id: number; student_name: string; admission_number: string; class_id: number | null; class_name: string; parent_account: string }
type LiaisonThread = { id: number; student_id: number; student_name: string; parent_name: string; subject: string; category: string; status: string; updated_at: string; last_message: string; last_sender_id: number | null }
type LiaisonDetail = { current_user_id: number; id: number; student_id: number; student_name: string; subject: string; category: string; status: string; messages: { id: number; sender_id: number; sender_name: string; sender_role: string; message: string; created_at: string; read_at: string | null }[] }

export default function ParentLiaisonWorkspace({ token, role }: { token: string; role: string }) {
  const isParent = role === 'parent'
  const [threads, setThreads] = useState<LiaisonThread[]>([])
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<LiaisonDetail | null>(null)
  const [compose, setCompose] = useState(false)
  const [studentId, setStudentId] = useState('')
  const [studentSearch, setStudentSearch] = useState('')
  const [classFilter, setClassFilter] = useState('')
  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState('General enquiry')
  const [firstMessage, setFirstMessage] = useState('')
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function loadThreads(preferredId?: number | null) {
    const rows = await api<LiaisonThread[]>('parent-liaison/threads', token)
    setThreads(rows)
    const wanted = preferredId ?? selectedId
    const chosen = wanted && rows.some(row => row.id === wanted) ? wanted : rows[0]?.id ?? null
    setSelectedId(chosen)
    if (chosen) setDetail(await api<LiaisonDetail>(`parent-liaison/threads/${chosen}`, token))
    else setDetail(null)
  }

  useEffect(() => {
    let cancelled = false
    setBusy(true); setError('')
    Promise.all([
      api<LiaisonThread[]>('parent-liaison/threads', token),
      isParent ? Promise.resolve([] as Recipient[]) : api<Recipient[]>('parent-liaison/recipients', token),
    ]).then(async ([rows, targets]) => {
      if (cancelled) return
      setThreads(rows); setRecipients(targets)
      const chosen = rows[0]?.id ?? null
      setSelectedId(chosen)
      if (chosen) {
        const value = await api<LiaisonDetail>(`parent-liaison/threads/${chosen}`, token)
        if (!cancelled) setDetail(value)
      }
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load Parent Liaison.') })
      .finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [token, role])

  useEffect(() => {
    if (isParent || !compose) return
    let cancelled = false
    const params = new URLSearchParams()
    if (studentSearch.trim()) params.set('search', studentSearch.trim())
    if (classFilter) params.set('class_id', classFilter)
    api<Recipient[]>('parent-liaison/recipients?' + params.toString(), token)
      .then(rows => { if (!cancelled) setRecipients(rows) })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to search students.') })
    return () => { cancelled = true }
  }, [isParent, compose, studentSearch, classFilter, token])

  async function openThread(id: number) {
    setSelectedId(id); setError('')
    try { setDetail(await api<LiaisonDetail>(`parent-liaison/threads/${id}`, token)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to open communication.') }
  }

  async function startCommunication(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      const created = await api<{ id: number }>('parent-liaison/threads', token, { method: 'POST', body: JSON.stringify({
        student_id: Number(studentId), subject, category, message: firstMessage,
      }) })
      setCompose(false); setStudentId(''); setStudentSearch(''); setClassFilter(''); setSubject(''); setFirstMessage('')
      await loadThreads(created.id)
      setNotice('Communication sent to the linked parent account.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to send communication.') }
    finally { setBusy(false) }
  }

  async function updateStatus() {
    if (!detail) return
    const nextStatus = detail.status === 'Open' ? 'Closed' : 'Open'
    const prompt = nextStatus === 'Closed'
      ? 'Close this conversation? The parent will still be able to read the messages, but will not be able to reply unless an authorised staff member reopens it.'
      : 'Reopen this conversation so the parent can reply again?'
    if (!window.confirm(prompt)) return
    setBusy(true); setError(''); setNotice('')
    try {
      await api('parent-liaison/threads/' + detail.id + '/status?status=' + nextStatus, token, { method: 'PATCH' })
      await loadThreads(detail.id)
      setNotice(nextStatus === 'Closed' ? 'Conversation closed. Its full history has been retained.' : 'Conversation reopened. The parent can now reply.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to update conversation status.') }
    finally { setBusy(false) }
  }
  async function sendReply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!detail || !reply.trim()) return
    setBusy(true); setError('')
    try {
      await api(`parent-liaison/threads/${detail.id}/messages`, token, { method: 'POST', body: JSON.stringify({ message: reply }) })
      setReply('')
      await loadThreads(detail.id)
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to send reply.') }
    finally { setBusy(false) }
  }

  const selectedRecipient = recipients.find(row => String(row.student_id) === studentId)
  const availableClasses = Array.from(new Map(recipients.filter(row => row.class_id !== null).map(row => [row.class_id as number, { id: row.class_id as number, name: row.class_name }])).values())
  const visibleRecipients = recipients
  return <div className="phase4-workspace parent-liaison-workspace">
    <section className="panel">
      <div className="panel-heading">
        <div><h2><MessageSquareText size={21}/> Parent Liaison</h2><p>{isParent ? 'Respond to official school communications concerning your child.' : 'Send and manage student-related communications with linked parents.'}</p></div>
        {!isParent && <button className="primary-button" type="button" onClick={() => { setCompose(value => !value); setNotice(''); setError('') }}><PlusCircle size={16}/>{compose ? 'Close form' : 'New communication'}</button>}
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
      {notice && <div className="success-notice" role="status">{notice}</div>}
      {!isParent && compose && <form className="student-form parent-liaison-compose" onSubmit={startCommunication}>
        <div className="form-heading"><div><h3>Start a school communication</h3><p>Search by student name or admission number, then narrow the results by class. The linked shared parent account is selected automatically.</p></div></div>
        <div className="student-form-grid">
          <label>Search student *<input required value={studentSearch} onChange={e => { setStudentSearch(e.target.value); setStudentId('') }} placeholder="Name or admission number" /></label>
          <label>Filter by class<select value={classFilter} onChange={e => { setClassFilter(e.target.value); setStudentId('') }}><option value="">All classes</option>{availableClasses.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="field-span-full">Matching student *
            <select required value={studentId} onChange={e => setStudentId(e.target.value)}>
              <option value="">Choose a student from the filtered results</option>
              {visibleRecipients.map(row => <option key={row.student_id} value={row.student_id}>{row.student_name} · {row.admission_number} · {row.class_name}</option>)}
            </select>
            <small className="field-hint">{visibleRecipients.length} matching students. Parent account: {selectedRecipient?.parent_account || 'Select a student to resolve the linked account'}.</small>
          </label>
          <label>Communication category *
            <select value={category} onChange={e => setCategory(e.target.value)}>
              {['Academic performance','Attendance','Behaviour and discipline','Fees and payments','Meeting request','General enquiry'].map(item => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>Subject *<input required minLength={3} maxLength={160} value={subject} onChange={e => setSubject(e.target.value)} placeholder="Brief subject of the communication"/></label>
          <label className="field-span-full">Message *<textarea required minLength={2} maxLength={5000} rows={4} value={firstMessage} onChange={e => setFirstMessage(e.target.value)} placeholder="Write a clear, school-related message."/></label>
        </div>
        <div className="form-actions"><button className="primary-button" disabled={busy || !recipients.length}><Send size={15}/>{busy ? 'Sending…' : 'Send to parent'}</button><span className="form-hint">Parents can reply to this communication but cannot start an unrestricted conversation.</span></div>
      </form>}
      <div className="parent-liaison-layout">
        <aside className="parent-liaison-list" aria-label="Communication records">
          <div className="parent-liaison-list-heading"><strong>Communications</strong><span>{threads.length}</span></div>
          {threads.map(item => <button type="button" key={item.id} className={selectedId === item.id ? 'parent-liaison-thread active' : 'parent-liaison-thread'} onClick={() => void openThread(item.id)}>
            <span className="parent-liaison-thread-icon"><GraduationCap size={17}/></span>
            <span className="parent-liaison-thread-copy"><strong>{item.subject}</strong><small>{item.student_name} · {isParent ? 'School' : item.parent_name}</small><span>{item.last_message || 'No messages yet'}</span></span>
            <span className={item.status === 'Open' ? 'parent-liaison-status-mini open' : 'parent-liaison-status-mini closed'}>{item.status}</span><small className="parent-liaison-thread-date">{new Date(item.updated_at).toLocaleDateString('en-UG', { day: 'numeric', month: 'short' })}</small>
          </button>)}
          {!threads.length && <div className="empty-state">{busy ? 'Loading communications…' : 'No Parent Liaison records yet.'}</div>}
        </aside>
        <section className="parent-liaison-conversation">
          {detail ? <>
            <header className="parent-liaison-conversation-head">  <div><strong>{detail.subject}</strong><span>{detail.student_name} · {detail.category}</span>    <small className={detail.status === 'Open' ? 'parent-liaison-awaiting' : 'parent-liaison-closed-note'}>{detail.status === 'Open' ? (detail.messages.some(message => message.sender_role === 'parent') ? 'Parent has responded' : 'Awaiting parent response') : (detail.messages.some(message => message.sender_role === 'parent') ? 'Closed · parent response received' : 'Closed · no parent response received')}</small>  </div>  <div className="parent-liaison-head-actions"><span className={detail.status === 'Open' ? 'parent-liaison-status-pill open' : 'parent-liaison-status-pill closed'}>{detail.status}</span>    {!isParent && <button type="button" className={detail.status === 'Open' ? 'parent-liaison-close-button' : 'parent-liaison-reopen-button'} onClick={() => void updateStatus()} disabled={busy}>{detail.status === 'Open' ? <><LockKeyhole size={14}/> Close conversation</> : <><Unlock size={14}/> Reopen conversation</>}</button>}  </div></header>
            <div className="parent-liaison-messages">
              {detail.messages.map(item => <article key={item.id} className={item.sender_id === detail.current_user_id ? 'parent-liaison-message sent' : 'parent-liaison-message received'}>
                <div className="parent-liaison-message-meta"><strong>{item.sender_name}</strong><time>{new Date(item.created_at).toLocaleString('en-UG', { dateStyle: 'medium', timeStyle: 'short' })}</time></div>
                <p>{item.message}</p>
                {item.read_at && <small><CheckCheck size={12}/> Read</small>}
              </article>)}
            </div>
            {detail.status === 'Open' && <form className="parent-liaison-reply" onSubmit={sendReply}><div className="parent-liaison-compose-box"><textarea rows={3} value={reply} onChange={e => setReply(e.target.value)} placeholder={isParent ? 'Write your response to the school…' : 'Write a school-related reply…'} required maxLength={5000} aria-label="Message text"/><div className="parent-liaison-compose-footer"><span>{reply.length}/5000 characters</span><button className="primary-button" disabled={busy || !reply.trim()}><Send size={15}/> {busy ? 'Sending…' : 'Send message'}</button></div></div></form>}
            {detail.status !== 'Open' && <div className="parent-liaison-closed-banner"><LockKeyhole size={16}/><div><strong>This conversation is closed</strong><span>{isParent ? 'You can still read the full conversation. Contact the school office if you need to follow up.' : (detail.messages.some(message => message.sender_role === 'parent') ? 'The parent responded before this conversation was closed.' : 'The conversation was closed before the parent replied. No response has been recorded.')}</span></div></div>}
          </> : <div className="parent-liaison-empty"><MessageSquareText size={30}/><strong>Select a communication</strong><span>School-related messages will appear here.</span></div>}
        </section>
      </div>
      {!isParent && !recipients.length && <p className="form-hint">No students with linked parent accounts are currently available within your authorised classes or permissions.</p>}
    </section>
  </div>
}
