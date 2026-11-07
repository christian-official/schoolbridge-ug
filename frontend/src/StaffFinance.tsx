import { useEffect, useState, type FormEvent } from 'react'
import { Users, Plus, Search, Wallet, ReceiptText } from 'lucide-react'

type Staff = { id:number; staff_number:string; first_name:string; last_name:string; category:string; position?:string; department?:string; phone?:string; email?:string; salary_amount?:number|null; salary_frequency?:string; status?:string }
type Page<T> = { items:T[]; total:number; page:number; pages:number }
type Summary = { fees_expected:number; fees_collected:number; outstanding:number; salary_expenses?:number; other_expenses?:number; total_expenses?:number; net_cash_position?:number }
type Charge = { id:number; student_id:number; student_name:string; admission_number:string; class_id?:number|null; class_name?:string; stream?:string; term:string; year:number; amount:number; paid:number; balance:number }

async function request<T>(path:string, token:string, options:RequestInit={}):Promise<T> {
  const response = await fetch('/api/'+path, { ...options, headers:{ Authorization:'Bearer '+token, ...(options.body?{'Content-Type':'application/json'}:{}), ...options.headers } })
  const data = await response.json().catch(()=>({}))
  if(!response.ok) throw new Error(data.detail || 'Request failed')
  return data as T
}

export default function StaffFinance({token,active,classes=[]}:{token:string;active:string;classes?:{id:number;name?:string;section?:string}[]}) {
  const [staff,setStaff]=useState<Staff[]>([])
  const [staffTotal,setStaffTotal]=useState(0)
  const [search,setSearch]=useState('')
  const [category,setCategory]=useState('')
  const [showForm,setShowForm]=useState(false)
  const [editingStaff,setEditingStaff]=useState<number|null>(null)
  const [message,setMessage]=useState('')
  const [form,setForm]=useState({first_name:'',last_name:'',category:'Teaching',position:'',department:'',phone:'',email:'',salary_amount:'',salary_frequency:'Monthly'})
  const [summary,setSummary]=useState<Summary>({fees_expected:0,fees_collected:0,outstanding:0})
  const [charges,setCharges]=useState<Charge[]>([])
  const [expenseForm,setExpenseForm]=useState({description:'',category:'General',amount:'',reference:''})
  const [salaryForm,setSalaryForm]=useState({staff_id:'',amount:'',period:'',reference:''})
  const [feeSearch,setFeeSearch]=useState('')
  const [feeClass,setFeeClass]=useState('')
  const [outstandingOnly,setOutstandingOnly]=useState(false)
  const [payment,setPayment]=useState({charge_id:'',amount:'',method:'Cash',reference:''})
  const [receipt,setReceipt]=useState<{receipt_number:string;charge:Charge;amount:number;method:string;date:string}|null>(null)
  const [schoolProfile,setSchoolProfile]=useState<{name:string;phone?:string;email?:string;address?:string}>({name:'SchoolBridge'})

  useEffect(()=>{
    if(active!=='Staff' && active!=='Fees & Finance') return
    const params=new URLSearchParams({search,page:'1',page_size:'100'})
    if(category) params.set('category',category)
    request<Page<Staff>>('staff?'+params.toString(),token).then(r=>{setStaff(r.items);setStaffTotal(r.total)}).catch(e=>setMessage(e.message))
  },[active,search,category,token])

  async function refreshFinance(){
    const [s,c]=await Promise.all([request<Summary>('finance/summary',token),request<Charge[]>('finance/charges?search='+encodeURIComponent(feeSearch)+'&class_id='+encodeURIComponent(feeClass)+'&outstanding_only='+String(outstandingOnly),token)])
    setSummary(s);setCharges(c)
  }
  useEffect(()=>{if(active==='Fees & Finance'){refreshFinance().catch(e=>setMessage(e.message));request<any>('settings/school-profile',token).then(setSchoolProfile).catch(()=>{})}},[active,feeSearch,feeClass,outstandingOnly,token])

  async function addStaff(e:FormEvent){
    e.preventDefault();setMessage('')
    try { await request(editingStaff?'staff/'+editingStaff:'staff',token,{method:editingStaff?'PATCH':'POST',body:JSON.stringify({...form,salary_amount:form.salary_amount===''?null:Number(form.salary_amount)})});setEditingStaff(null);setForm({first_name:'',last_name:'',category:'Teaching',position:'',department:'',phone:'',email:'',salary_amount:'',salary_frequency:'Monthly'});setShowForm(false);setMessage(editingStaff?'Staff profile updated.':'Staff member registered.');const p=new URLSearchParams({search,page:'1',page_size:'100'});if(category)p.set('category',category);const r=await request<Page<Staff>>('staff?'+p.toString(),token);setStaff(r.items);setStaffTotal(r.total) }
    catch(e){setMessage(e instanceof Error?e.message:'Unable to save staff member.')}
  }
  async function archiveStaff(id:number){
    if(!window.confirm('Archive this staff member? Their records and salary history will be retained.')) return
    try {await request('staff/'+id+'/archive',token,{method:'POST'});setMessage('Staff member archived.');const p=new URLSearchParams({search,page:'1',page_size:'100'});if(category)p.set('category',category);const r=await request<Page<Staff>>('staff?'+p.toString(),token);setStaff(r.items);setStaffTotal(r.total)}
    catch(e){setMessage(e instanceof Error?e.message:'Unable to archive staff member.')}
  }
  async function saveOtherExpense(e:FormEvent){
    e.preventDefault();setMessage('')
    try {await request('finance/other-expenses',token,{method:'POST',body:JSON.stringify({...expenseForm,amount:Number(expenseForm.amount),reference:expenseForm.reference||null})});setExpenseForm({description:'',category:'General',amount:'',reference:''});setMessage('Expense recorded.');await refreshFinance()}
    catch(e){setMessage(e instanceof Error?e.message:'Unable to record expense.')}
  }
  async function saveSalaryPayment(e:FormEvent){
    e.preventDefault();setMessage('')
    try {await request('finance/salary-payments',token,{method:'POST',body:JSON.stringify({...salaryForm,staff_id:Number(salaryForm.staff_id),amount:Number(salaryForm.amount),reference:salaryForm.reference||null})});setSalaryForm({staff_id:'',amount:'',period:'',reference:''});setMessage('Salary payment recorded.');await refreshFinance()}
    catch(e){setMessage(e instanceof Error?e.message:'Unable to record salary payment.')}
  }
  function printReminders(){
    const rows=charges.filter(c=>c.balance>0)
    const escape=(value:string)=>value.replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]||ch))
    const content=rows.map(c=>'<tr><td>'+escape(c.student_name)+'</td><td>'+escape(c.admission_number)+'</td><td>'+escape((c.class_name||'')+' '+(c.stream||''))+'</td><td>'+escape(c.term+' '+c.year)+'</td><td>UGX '+c.balance.toLocaleString()+'</td></tr>').join('')
    const page=window.open('','_blank')
    if(!page){setMessage('Allow pop-ups to print fee reminders.');return}
    page.document.write('<!doctype html><html><head><title>Outstanding fee reminders</title><style>body{font-family:Arial,sans-serif;padding:28px}h1{font-size:22px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #bbb;padding:9px;text-align:left}th{background:#eee}</style></head><body><h1>Outstanding Fee Balances</h1><p>SchoolBridge · '+new Date().toLocaleDateString()+'</p><table><thead><tr><th>Student</th><th>Admission number</th><th>Class / Stream</th><th>Term</th><th>Balance</th></tr></thead><tbody>'+content+'</tbody></table></body></html>')
    page.document.close();page.focus();page.print()
  }
  async function pay(e:FormEvent){
    e.preventDefault();setMessage('')
    try { const saved=await request<{receipt_number:string;amount:number;payment_date:string}>('finance/payments',token,{method:'POST',body:JSON.stringify({charge_id:Number(payment.charge_id),amount:Number(payment.amount),method:payment.method,reference:payment.reference||null})});const charge=charges.find(c=>c.id===Number(payment.charge_id));if(charge)setReceipt({receipt_number:saved.receipt_number,charge,amount:saved.amount,method:payment.method,date:saved.payment_date});setPayment({charge_id:'',amount:'',method:'Cash',reference:''});setMessage('Payment recorded. Receipt generated.');await refreshFinance() }
    catch(e){setMessage(e instanceof Error?e.message:'Unable to record payment.')}
  }

  if(active==='Staff') return <section className="panel">
    <div className="panel-heading"><div><h2>Staff directory</h2><p>{staffTotal} staff members · teaching and non-teaching</p></div><button className="primary-button add-student-button" onClick={()=>{setEditingStaff(null);setShowForm(v=>!v)}}><Plus size={16}/>{showForm?'Close form':'Add staff member'}</button></div>
    {message&&<div className="success-notice">{message}</div>}
    {showForm&&<form className="student-form" onSubmit={addStaff}><div className="student-form-grid">
      <label>First name *<input required value={form.first_name} onChange={e=>setForm({...form,first_name:e.target.value})}/></label>
      <label>Last name *<input required value={form.last_name} onChange={e=>setForm({...form,last_name:e.target.value})}/></label>
      <label>Category<select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}><option>Teaching</option><option>Non-teaching</option></select></label>
      <label>Position<input value={form.position} onChange={e=>setForm({...form,position:e.target.value})}/></label>
      <label>Department<input value={form.department} onChange={e=>setForm({...form,department:e.target.value})}/></label>
      <label>Phone<input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label>
      <label>Email<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label><label>Salary amount (UGX)<input type="number" min="0" value={form.salary_amount} onChange={e=>setForm({...form,salary_amount:e.target.value})}/></label><label>Pay frequency<select value={form.salary_frequency} onChange={e=>setForm({...form,salary_frequency:e.target.value})}><option>Monthly</option><option>Termly</option><option>Weekly</option><option>Daily</option></select></label>
    </div><div className="form-actions"><button className="primary-button">{editingStaff?'Update staff profile':'Save staff member'}</button></div></form>}
    <div className="table-tools student-tools"><div className="search-box"><Search size={17}/><input placeholder="Search name or staff number..." value={search} onChange={e=>setSearch(e.target.value)}/></div><select className="filter-select" value={category} onChange={e=>setCategory(e.target.value)}><option value="">All staff</option><option>Teaching</option><option>Non-teaching</option></select></div>
    <div className="table-wrap"><table><thead><tr><th>Staff member</th><th>Staff number</th><th>Category</th><th>Position</th><th>Department</th><th>Phone</th><th>Salary (UGX)</th><th>Status</th><th>Actions</th></tr></thead><tbody>{staff.map(s=><tr key={s.id}><td>{s.first_name} {s.last_name}</td><td>{s.staff_number}</td><td>{s.category}</td><td>{s.position||'—'}</td><td>{s.department||'—'}</td><td>{s.phone||'—'}</td><td>{s.salary_amount?.toLocaleString()||'—'} {s.salary_frequency||''}</td><td>{s.status||'active'}</td><td><button type="button" className="secondary-button" onClick={()=>{setEditingStaff(s.id);setForm({first_name:s.first_name,last_name:s.last_name,category:s.category,position:s.position||'',department:s.department||'',phone:s.phone||'',email:s.email||'',salary_amount:s.salary_amount==null?'':String(s.salary_amount),salary_frequency:s.salary_frequency||'Monthly'});setShowForm(true)}}>Edit</button>{s.status!=='archived'&&<button type="button" className="secondary-button" onClick={()=>void archiveStaff(s.id)}>Archive</button>}</td></tr>)}</tbody></table></div>
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
    <div className="panel-heading"><div><h2>Find the student first</h2><p>Search by name or admission number before choosing a fee charge. Class and stream are shown to distinguish students with the same name.</p></div></div>
    <div className="table-tools"><div className="search-box"><Search size={17}/><input placeholder="Enter student name or admission number..." value={feeSearch} onChange={e=>setFeeSearch(e.target.value)}/></div></div>
    <div className="panel-heading"><div><h2>Record a payment</h2><p>Partial payments are supported; overpayments are blocked.</p></div></div>
    <form className="student-form" onSubmit={pay}><div className="student-form-grid">
      <label>Student term charge *<select required value={payment.charge_id} onChange={e=>setPayment({...payment,charge_id:e.target.value})}><option value="">Select outstanding charge</option>{charges.filter(c=>c.balance>0).map(c=><option key={c.id} value={c.id}>{c.student_name} · {c.admission_number} · {c.class_name||'No class'} {c.stream?'— '+c.stream:''} · {c.term} {c.year} · UGX {c.balance.toLocaleString()}</option>)}</select></label>
      <label>Amount received (UGX) *<input type="number" min="1" required value={payment.amount} onChange={e=>setPayment({...payment,amount:e.target.value})}/></label>
      <label>Payment method<select value={payment.method} onChange={e=>setPayment({...payment,method:e.target.value})}><option>Cash</option><option>Bank</option><option>Mobile Money</option><option>Cheque</option></select></label>
      <label>Reference / receipt number<input value={payment.reference} onChange={e=>setPayment({...payment,reference:e.target.value})}/></label>
    </div><div className="form-actions"><button className="primary-button" disabled={!charges.some(c=>c.balance>0)}>Record payment</button></div></form>
    {receipt&&<section className="panel receipt-print"><div className="panel-heading"><div><h2>{schoolProfile.name||'SchoolBridge'}</h2><p>Official fee payment receipt · {schoolProfile.phone||''} {schoolProfile.email||''}</p></div><button className="secondary-button" type="button" onClick={()=>window.print()}>Print receipt</button></div><div className="receipt-details"><strong>Receipt: {receipt.receipt_number}</strong><p>Student: {receipt.charge.student_name}</p><p>Admission number: {receipt.charge.admission_number}</p><p>Class: {receipt.charge.class_name||'—'} {receipt.charge.stream||''}</p><p>Fee: {receipt.charge.term} {receipt.charge.year}</p><p>Amount received: UGX {receipt.amount.toLocaleString()}</p><p>Payment method: {receipt.method}</p><p>Date: {receipt.date}</p></div></section>}
    <div className="panel-heading"><div><h2>Record staff salary payment</h2><p>Recorded salary payments contribute to school expenses.</p></div></div>
    <form className="student-form" onSubmit={saveSalaryPayment}><div className="student-form-grid"><label>Staff member<select required value={salaryForm.staff_id} onChange={e=>setSalaryForm({...salaryForm,staff_id:e.target.value})}><option value="">Select staff member</option>{staff.filter(x=>x.status!=='archived').map(x=><option key={x.id} value={x.id}>{x.first_name} {x.last_name} · {x.staff_number}</option>)}</select></label><label>Amount (UGX)<input required type="number" min="1" value={salaryForm.amount} onChange={e=>setSalaryForm({...salaryForm,amount:e.target.value})}/></label><label>Salary period<input required placeholder="e.g. November 2026" value={salaryForm.period} onChange={e=>setSalaryForm({...salaryForm,period:e.target.value})}/></label><label>Reference<input value={salaryForm.reference} onChange={e=>setSalaryForm({...salaryForm,reference:e.target.value})}/></label></div><div className="form-actions"><button className="primary-button">Record salary payment</button></div></form>
    <div className="panel-heading"><div><h2>Record other school expense</h2></div></div>
    <form className="student-form" onSubmit={saveOtherExpense}><div className="student-form-grid"><label>Description<input required value={expenseForm.description} onChange={e=>setExpenseForm({...expenseForm,description:e.target.value})}/></label><label>Category<select value={expenseForm.category} onChange={e=>setExpenseForm({...expenseForm,category:e.target.value})}><option>General</option><option>Utilities</option><option>Supplies</option><option>Maintenance</option><option>Transport</option><option>Other</option></select></label><label>Amount (UGX)<input required type="number" min="1" value={expenseForm.amount} onChange={e=>setExpenseForm({...expenseForm,amount:e.target.value})}/></label><label>Reference<input value={expenseForm.reference} onChange={e=>setExpenseForm({...expenseForm,reference:e.target.value})}/></label></div><div className="form-actions"><button className="primary-button">Record expense</button></div></form>
    <div className="panel-heading"><div><h2>Student fee balances</h2><p>Search by student name or admission number</p></div></div>
    <div className="table-tools"><select className="filter-select" value={feeClass} onChange={e=>setFeeClass(e.target.value)}><option value="">All classes and streams</option>{classes.map(c=><option key={c.id} value={c.id}>{c.name}{c.section?' — '+c.section:''}</option>)}</select><label className="settings-checkbox"><input type="checkbox" checked={outstandingOnly} onChange={e=>setOutstandingOnly(e.target.checked)}/> Outstanding only</label><button className="secondary-button" type="button" onClick={printReminders}>Print reminders</button></div>
    <div className="table-wrap"><table><thead><tr><th>Student</th><th>Admission no.</th><th>Term</th><th>Year</th><th>Charged (UGX)</th><th>Paid (UGX)</th><th>Balance (UGX)</th></tr></thead><tbody>{charges.map(c=><tr key={c.id}><td>{c.student_name}</td><td>{c.admission_number}</td><td>{c.term}</td><td>{c.year}</td><td>{c.amount.toLocaleString()}</td><td>{c.paid.toLocaleString()}</td><td><strong>{c.balance.toLocaleString()}</strong></td></tr>)}</tbody></table></div>
    {!charges.length&&<div className="empty-state"><Wallet size={30}/><p>No fee charges match this search. Set standard fees in Settings → Fee Structure.</p></div>}
  </section>
  return null
}
