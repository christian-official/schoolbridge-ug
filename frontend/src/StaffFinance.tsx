import { useEffect, useState, type FormEvent } from 'react'
import { Users, Plus, Search, Wallet, ReceiptText } from 'lucide-react'

type Staff = { id:number; staff_number:string; first_name:string; last_name:string; category:string; position?:string; department?:string; phone?:string; email?:string; salary_amount?:number|null; salary_frequency?:string; status?:string }
type Page<T> = { items:T[]; total:number; page:number; pages:number }
type Summary = { fees_expected:number; fees_collected:number; outstanding:number; salary_expenses?:number; other_expenses?:number; total_expenses?:number; net_cash_position?:number }
type Charge = { id:number; student_name:string; admission_number:string; term:string; year:number; amount:number; paid:number; balance:number }

async function request<T>(path:string, token:string, options:RequestInit={}):Promise<T> {
  const response = await fetch('/api/'+path, { ...options, headers:{ Authorization:'Bearer '+token, ...(options.body?{'Content-Type':'application/json'}:{}), ...options.headers } })
  const data = await response.json().catch(()=>({}))
  if(!response.ok) throw new Error(data.detail || 'Request failed')
  return data as T
}

export default function StaffFinance({token,active}:{token:string;active:string}) {
  const [staff,setStaff]=useState<Staff[]>([])
  const [staffTotal,setStaffTotal]=useState(0)
  const [search,setSearch]=useState('')
  const [category,setCategory]=useState('')
  const [showForm,setShowForm]=useState(false)
  const [message,setMessage]=useState('')
  const [form,setForm]=useState({first_name:'',last_name:'',category:'Teaching',position:'',department:'',phone:'',email:'',salary_amount:'',salary_frequency:'Monthly'})
  const [summary,setSummary]=useState<Summary>({fees_expected:0,fees_collected:0,outstanding:0})
  const [charges,setCharges]=useState<Charge[]>([])
  const [feeSearch,setFeeSearch]=useState('')
  const [payment,setPayment]=useState({charge_id:'',amount:'',method:'Cash',reference:''})

  useEffect(()=>{
    if(active!=='Staff') return
    const params=new URLSearchParams({search,page:'1',page_size:'100'})
    if(category) params.set('category',category)
    request<Page<Staff>>('staff?'+params.toString(),token).then(r=>{setStaff(r.items);setStaffTotal(r.total)}).catch(e=>setMessage(e.message))
  },[active,search,category,token])

  async function refreshFinance(){
    const [s,c]=await Promise.all([request<Summary>('finance/summary',token),request<Charge[]>('finance/charges?search='+encodeURIComponent(feeSearch),token)])
    setSummary(s);setCharges(c)
  }
  useEffect(()=>{if(active==='Fees & Finance') refreshFinance().catch(e=>setMessage(e.message))},[active,feeSearch,token])

  async function addStaff(e:FormEvent){
    e.preventDefault();setMessage('')
    try { await request('staff',token,{method:'POST',body:JSON.stringify(form)});setForm({first_name:'',last_name:'',category:'Teaching',position:'',department:'',phone:'',email:'',salary_amount:'',salary_frequency:'Monthly'});setShowForm(false);setMessage('Staff member registered.');const p=new URLSearchParams({search,page:'1',page_size:'100'});if(category)p.set('category',category);const r=await request<Page<Staff>>('staff?'+p.toString(),token);setStaff(r.items);setStaffTotal(r.total) }
    catch(e){setMessage(e instanceof Error?e.message:'Unable to save staff member.')}
  }
  async function pay(e:FormEvent){
    e.preventDefault();setMessage('')
    try { await request('finance/payments',token,{method:'POST',body:JSON.stringify({charge_id:Number(payment.charge_id),amount:Number(payment.amount),method:payment.method,reference:payment.reference||null})});setPayment({charge_id:'',amount:'',method:'Cash',reference:''});setMessage('Payment recorded successfully.');await refreshFinance() }
    catch(e){setMessage(e instanceof Error?e.message:'Unable to record payment.')}
  }

  if(active==='Staff') return <section className="panel">
    <div className="panel-heading"><div><h2>Staff directory</h2><p>{staffTotal} staff members · teaching and non-teaching</p></div><button className="primary-button add-student-button" onClick={()=>setShowForm(v=>!v)}><Plus size={16}/>{showForm?'Close form':'Add staff member'}</button></div>
    {message&&<div className="success-notice">{message}</div>}
    {showForm&&<form className="student-form" onSubmit={addStaff}><div className="student-form-grid">
      <label>First name *<input required value={form.first_name} onChange={e=>setForm({...form,first_name:e.target.value})}/></label>
      <label>Last name *<input required value={form.last_name} onChange={e=>setForm({...form,last_name:e.target.value})}/></label>
      <label>Category<select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}><option>Teaching</option><option>Non-teaching</option></select></label>
      <label>Position<input value={form.position} onChange={e=>setForm({...form,position:e.target.value})}/></label>
      <label>Department<input value={form.department} onChange={e=>setForm({...form,department:e.target.value})}/></label>
      <label>Phone<input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label>
      <label>Email<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label><label>Salary amount (UGX)<input type="number" min="0" value={form.salary_amount} onChange={e=>setForm({...form,salary_amount:e.target.value})}/></label><label>Pay frequency<select value={form.salary_frequency} onChange={e=>setForm({...form,salary_frequency:e.target.value})}><option>Monthly</option><option>Termly</option><option>Weekly</option><option>Daily</option></select></label>
    </div><div className="form-actions"><button className="primary-button">Save staff member</button></div></form>}
    <div className="table-tools student-tools"><div className="search-box"><Search size={17}/><input placeholder="Search name or staff number..." value={search} onChange={e=>setSearch(e.target.value)}/></div><select className="filter-select" value={category} onChange={e=>setCategory(e.target.value)}><option value="">All staff</option><option>Teaching</option><option>Non-teaching</option></select></div>
    <div className="table-wrap"><table><thead><tr><th>Staff member</th><th>Staff number</th><th>Category</th><th>Position</th><th>Department</th><th>Phone</th><th>Salary (UGX)</th><th>Status</th></tr></thead><tbody>{staff.map(s=><tr key={s.id}><td>{s.first_name} {s.last_name}</td><td>{s.staff_number}</td><td>{s.category}</td><td>{s.position||'—'}</td><td>{s.department||'—'}</td><td>{s.phone||'—'}</td><td>{s.salary_amount?.toLocaleString()||'—'} {s.salary_frequency||''}</td><td>{s.status||'active'}</td></tr>)}</tbody></table></div>
    {!staff.length&&<div className="empty-state"><Users size={30}/><p>No staff members match this search.</p></div>}
  </section>

  if(active==='Fees & Finance') return <section className="panel">
    <div className="panel-heading"><div><h2>Fees and finance</h2><p>Term charges, payments and outstanding balances</p></div></div>
    {message&&<div className="success-notice">{message}</div>}
    <div className="stats-grid finance-stats">
      <div className="stat-card"><div className="stat-top">Fees expected <Wallet size={18}/></div><strong className="stat-value">UGX {summary.fees_expected.toLocaleString()}</strong><small>Total recorded charges</small></div>
      <div className="stat-card"><div className="stat-top">Fees collected <ReceiptText size={18}/></div><strong className="stat-value">UGX {summary.fees_collected.toLocaleString()}</strong><small>Payments received</small></div>
      <div className="stat-card"><div className="stat-top">Outstanding <Wallet size={18}/></div><strong className="stat-value">UGX {summary.outstanding.toLocaleString()}</strong><small>Remaining balances</small></div>
      <div className="stat-card"><div className="stat-top">Salary expenses <Wallet size={18}/></div><strong className="stat-value">UGX {(summary.salary_expenses||0).toLocaleString()}</strong><small>Recorded salary payments</small></div>
      <div className="stat-card"><div className="stat-top">Other expenses <Wallet size={18}/></div><strong className="stat-value">UGX {(summary.other_expenses||0).toLocaleString()}</strong><small>Recorded school expenses</small></div>
      <div className="stat-card"><div className="stat-top">Net cash position <Wallet size={18}/></div><strong className="stat-value">UGX {(summary.net_cash_position||0).toLocaleString()}</strong><small>Collected fees less recorded expenses</small></div>
    </div>
    <div className="panel-heading"><div><h2>Record a payment</h2><p>Partial payments are supported; overpayments are blocked.</p></div></div>
    <form className="student-form" onSubmit={pay}><div className="student-form-grid">
      <label>Student term charge *<select required value={payment.charge_id} onChange={e=>setPayment({...payment,charge_id:e.target.value})}><option value="">Select outstanding charge</option>{charges.filter(c=>c.balance>0).map(c=><option key={c.id} value={c.id}>{c.student_name} · {c.admission_number} · {c.term} {c.year} · UGX {c.balance.toLocaleString()}</option>)}</select></label>
      <label>Amount received (UGX) *<input type="number" min="1" required value={payment.amount} onChange={e=>setPayment({...payment,amount:e.target.value})}/></label>
      <label>Payment method<select value={payment.method} onChange={e=>setPayment({...payment,method:e.target.value})}><option>Cash</option><option>Bank</option><option>Mobile Money</option><option>Cheque</option></select></label>
      <label>Reference / receipt number<input value={payment.reference} onChange={e=>setPayment({...payment,reference:e.target.value})}/></label>
    </div><div className="form-actions"><button className="primary-button" disabled={!charges.some(c=>c.balance>0)}>Record payment</button></div></form>
    <div className="panel-heading"><div><h2>Student fee balances</h2><p>Search by student name or admission number</p></div></div>
    <div className="table-tools"><div className="search-box"><Search size={17}/><input placeholder="Search fee records..." value={feeSearch} onChange={e=>setFeeSearch(e.target.value)}/></div></div>
    <div className="table-wrap"><table><thead><tr><th>Student</th><th>Admission no.</th><th>Term</th><th>Year</th><th>Charged (UGX)</th><th>Paid (UGX)</th><th>Balance (UGX)</th></tr></thead><tbody>{charges.map(c=><tr key={c.id}><td>{c.student_name}</td><td>{c.admission_number}</td><td>{c.term}</td><td>{c.year}</td><td>{c.amount.toLocaleString()}</td><td>{c.paid.toLocaleString()}</td><td><strong>{c.balance.toLocaleString()}</strong></td></tr>)}</tbody></table></div>
    {!charges.length&&<div className="empty-state"><Wallet size={30}/><p>No fee charges yet. Enter term fees when registering a student.</p></div>}
  </section>
  return null
}
