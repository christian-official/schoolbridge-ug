import { useEffect, useState } from 'react'
import { MessageSquareText, Send, PlusCircle, ArrowLeft, UserRound, GraduationCap, Clock3, CheckCheck } from 'lucide-react'

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

type Recipient = { student_id: number; student_name: string; admission_number: string; class_name: string; parents: { id: number; username: string; email: string }[] }
type LiaisonThread = { id: number; student_id: number; student_name: string; parent_name: string; subject: string; category: string; status: string; updated_at: string; last_message: string; last_sender_id: number | null }
type LiaisonDetail = { id: number; student_id: number; student_name: string; subject: string; category: string; status: string; messages: { id: number; sender_id: number; sender_name: string; message: string; created_at: string; read_at: string | null }[] }

export default function ParentLiaisonWorkspace({ token, role }: { token: string; role: string }) {
  const isParent = role === 'parent'
  const [threads, setThreads] = useState<LiaisonThread[]>([])
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<LiaisonDetail | null>(null)
  const [compose, setCompose] = useState(false)
  const [studentId, setStudentId] = useState('')
  const [parentId, setParentId] = useState('')
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
    const nextId = preferredId ?? selectedId
    const chosen = nextId && rows.some(row => row.id === nextId) ? nextId : rows[0]?.id ?? null
    setSelectedId(chosen)
    if (chosen) {
      const item = await api<LiaisonDetail>(`parent-liaison/threads/${chosen}`, token)
      setDetail(item)
    } else setDetail(null)
  }

  useEffect(() => {
    let cancelled = false
    setBusy(true); setError('')
    const requests: Promise<unknown>[] = [api<LiaisonThread[]>('parent-liaison/threads', token)]
    if (!isParent) requests.push(api<Recipient[]>('parent-liaison/recipients', token))
    Promise.all(requests).then(([rows, targets]) => {
      if (cancelled) return
      const items = rows as LiaisonThread[]
      setThreads(items)
      const chosen = items[0]?.id ?? null
      setSelectedId(chosen)
      if (chosen) api<LiaisonDetail>(`parent-liaison/threads/${chosen}`, token).then(value => { if (!cancelled) setDetail(value) }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load communication.') })
      if (!isParent) setRecipients((targets as Recipient[]) || [])
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load Parent Liaison.') })
      .finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [token, role])

  async function openThread(id: number) {
    setSelectedId(id); setError('')
    try { setDetail(await api<LiaisonDetail>(`parent-liaison/threads/${id}`, token)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to open communication.') }
  }

  async function startCommunication(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      const created = await api<{ id: number }>('parent-liaison/threads', token, { method: 'POST', body: JSON.stringify({
        student_id: Number(studentId), parent_user_id: Number(parentId), subject, category, message: firstMessage,
      }) })
      setCompose(false); setStudentId(''); setParentId(''); setSubject(''); setFirstMessage('')
      await loadThreads(created.id)
      setNotice('Communication sent to the linked parent account.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to send communication.') }
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
  const selectedThread = threads.find(row => row.id === selectedId)

  return <div className="phase4-workspace parent-liaison-workspace">
    <section className="panel">
      <div className="panel-heading">
        <div><h2><MessageSquareText size={21}/> Parent Liaison</h2><p>{isParent ? 'Respond to official school communications concerning your child.' : 'Send and manage student-related communications with linked parents.'}</p></div>
        {!isParent && <button className="primary-button" type="button" onClick={() => { setCompose(value => !value); setNotice(''); setError('') }}><PlusCircle size={16}/>{compose ? 'Close form' : 'New communication'}</button>}
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
      {notice && <div className="success-notice" role="status">{notice}</div>}
      {!isParent && compose && <form className="student-form parent-liaison-compose" onSubmit={startCommunication}>
        <div className="form-heading"><div><h3>Start a school communication</h3><p>Choose a student first. Only parent accounts linked to that student will be available.</p></div></div>
        <div className="student-form-grid">
          <label>Student *
            <select required value={studentId} onChange={e => { setStudentId(e.target.value); setParentId('') }}>
              <option value="">Select an authorised student</option>
              {recipients.map(row => <option key={row.student_id} value={row.student_id}>{row.student_name} · {row.admission_number} · {row.class_name}</option>)}
            </select>
          </label>
          <label>Linked parent account *
            <select required value={parentId} onChange={e => setParentId(e.target.value)} disabled={!selectedRecipient}>
              <option value="">Select linked parent</option>
              {selectedRecipient?.parents.map(parent => <option key={parent.id} value={parent.id}>{parent.username} · {parent.email}</option>)}
            </select>
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
            <small className="parent-liaison-thread-date">{new Date(item.updated_at).toLocaleDateString('en-UG', { day: 'numeric', month: 'short' })}</small>
          </button>)}
          {!threads.length && <div className="empty-state">{busy ? 'Loading communications…' : 'No Parent Liaison records yet.'}</div>}
        </aside>
        <section className="parent-liaison-conversation">
          {detail ? <>
            <header className="parent-liaison-conversation-head"><div><strong>{detail.subject}</strong><span>{detail.student_name} · {detail.category}</span></div><span className={detail.status === 'Open' ? 'attendance-status-pill status-present' : 'attendance-status-pill'}>{detail.status}</span></header>
            <div className="parent-liaison-messages">
              {detail.messages.map(item => <article key={item.id} className={item.sender_id === detail.messages[0]?.sender_id ? 'parent-liaison-message sent' : 'parent-liaison-message received'}>
                <div className="parent-liaison-message-meta"><strong>{item.sender_name}</strong><time>{new Date(item.created_at).toLocaleString('en-UG', { dateStyle: 'medium', timeStyle: 'short' })}</time></div>
                <p>{item.message}</p>
                {item.read_at && <small><CheckCheck size={12}/> Read</small>}
              </article>)}
            </div>
            {detail.status === 'Open' && <form className="parent-liaison-reply" onSubmit={sendReply}><textarea rows={2} value={reply} onChange={e => setReply(e.target.value)} placeholder="Write a reply…" required maxLength={5000}/><button className="primary-button" disabled={busy || !reply.trim()}><Send size={15}/> Send reply</button></form>}
            {detail.status !== 'Open' && <p className="form-hint">This communication has been closed.</p>}
          </> : <div className="parent-liaison-empty"><MessageSquareText size={30}/><strong>Select a communication</strong><span>School-related messages will appear here.</span></div>}
        </section>
      </div>
      {!isParent && !recipients.length && <p className="form-hint">No students with linked parent accounts are currently available within your authorised classes or permissions.</p>}
    </section>
  </div>
}
