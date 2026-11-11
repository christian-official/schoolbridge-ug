import { useEffect, useState, type FormEvent } from 'react'
import { Users, Plus, Search, Wallet, ReceiptText, RefreshCw, Building2, CloudUpload, LockKeyhole } from 'lucide-react'
import { saveEncryptedFinanceQueue, loadEncryptedFinanceQueue } from './syncStorage'

type Staff = { id:number; staff_number:string; first_name:string; last_name:string; category:string; position?:string; department?:string; subjects?:string|null; phone?:string; email?:string; house?:string|null; salary_amount?:number|null; salary_frequency?:string; status?:string }
type Page<T> = { items:T[]; total:number; page:number; pages:number }
type Summary = { fees_expected:number; fees_collected:number; outstanding:number; salary_expenses?:number; other_expenses?:number; total_expenses?:number; net_cash_position?:number }
type Charge = { id:number; student_id:number; student_name:string; admission_number:string; class_id?:number|null; class_name?:string; stream?:string; term:string; year:number; amount:number; paid:number; balance:number }
type StudentMatch = { id:number; first_name:string; middle_name?:string|null; last_name:string; admission_number:string; class_id?:number|null; status?:string }
type OfflineFinancePayment = { idempotency_key:string; charge_id:number; amount:number; method:string; reference:string|null; payment_date:string; base_sequence:number; student_name:string; admission_number:string; term:string; year:number }

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

async function request<T>(path:string, token:string, options:RequestInit={}):Promise<T> {
  const response = await fetch(`${API_BASE_URL}/api/${path}`, { ...options, headers:{ Authorization:'Bearer '+token, ...(options.body?{'Content-Type':'application/json'}:{}), ...options.headers } })
  const data = await response.json().catch(()=>({}))
  if(!response.ok) throw new Error(`${data.detail || 'Request failed'} (HTTP ${response.status})`)
  return data as T
}

export default function StaffFinance({token,active,classes=[],refreshKey=0,initialTab='overview',canAddStaff=false}:{token:string;active:string;classes?:{id:number;name?:string;section?:string}[];refreshKey?:number;initialTab?:'overview'|'payments'|'balances';canAddStaff?:boolean}) {
  const [staff,setStaff]=useState<Staff[]>([])
  const [subjectOptions,setSubjectOptions]=useState<{id:number;name:string;code?:string}[]>([])
  const [staffTotal,setStaffTotal]=useState(0)
  const [search,setSearch]=useState('')
  const [category,setCategory]=useState('')
  const [showForm,setShowForm]=useState(false)
  const [showPaymentForm,setShowPaymentForm]=useState(false)
  const [showSalaryForm,setShowSalaryForm]=useState(false)
  const [showExpenseForm,setShowExpenseForm]=useState(false)
  const [showFeeForm,setShowFeeForm]=useState(false)
  const [savingStaff,setSavingStaff]=useState(false)
  const [savingPayment,setSavingPayment]=useState(false)
  const [savingSalary,setSavingSalary]=useState(false)
  const [savingExpense,setSavingExpense]=useState(false)
  const [savingFee,setSavingFee]=useState(false)
  const [editingStaff,setEditingStaff]=useState<number|null>(null)
  const [message,setMessage]=useState('')
  const [newStaffLogin,setNewStaffLogin]=useState<{name:string;username:string;email:string;temporary_passcode:string}|null>(null)
  const emptyStaffForm={full_name:'',category:'Teaching',position:'',department:'',subjects:'',phone:'',email:'',house:'',salary_amount:'',salary_frequency:'Monthly'}
  const [form,setForm]=useState(emptyStaffForm)
  const [summary,setSummary]=useState<Summary>({fees_expected:0,fees_collected:0,outstanding:0})
  const [charges,setCharges]=useState<Charge[]>([])
  const [studentMatches,setStudentMatches]=useState<StudentMatch[]>([])
  const [selectedPaymentStudent,setSelectedPaymentStudent]=useState<StudentMatch|null>(null)
  const [selectedStudentCharges,setSelectedStudentCharges]=useState<Charge[]>([])
  const [allOutstanding,setAllOutstanding]=useState<Charge[]>([])
  const [financeTab,setFinanceTab]=useState<'overview'|'payments'|'balances'|'expenses'|'fees'>('overview')
  useEffect(()=>{setMessage('')},[active,financeTab])
  useEffect(()=>{if(active==='Fees & Finance')setFinanceTab(initialTab)},[active,initialTab])
  const [feeSetup,setFeeSetup]=useState({class_id:'',term:'Term 1',year:String(new Date().getFullYear()),boarding_amount:'',day_amount:''})
  const [expenseForm,setExpenseForm]=useState({description:'',category:'General',amount:'',reference:''})
  const [salaryForm,setSalaryForm]=useState({staff_id:'',amount:'',period:'',reference:''})
  const [feeSearch,setFeeSearch]=useState('')
  const [feeClass,setFeeClass]=useState('')
  const [outstandingOnly,setOutstandingOnly]=useState(true)
  const [payment,setPayment]=useState({charge_id:'',amount:'',method:'Cash',reference:''})
  const [receipt,setReceipt]=useState<{receipt_number:string;charge:Charge;amount:number;method:string;date:string}|null>(null)
  const [schoolProfile,setSchoolProfile]=useState<{name:string;phone?:string;email?:string;address?:string;house_names?:string}>({name:'SchoolBridge'})
  const [offlineFinancePassphrase,setOfflineFinancePassphrase]=useState('')
  const [offlineFinanceQueue,setOfflineFinanceQueue]=useState<OfflineFinancePayment[]>([])
  const [offlineFinanceStatus,setOfflineFinanceStatus]=useState('')
  const [offlineFinanceBusy,setOfflineFinanceBusy]=useState(false)

  useEffect(()=>{
    if(active!=='Staff' && active!=='Fees & Finance') return
    if(active==='Staff') request<{id:number;name:string;code?:string}[]>('subjects',token).then(setSubjectOptions).catch(e=>setMessage(e.message))
    request<{name:string;house_names?:string}>('settings/school-profile',token).then(setSchoolProfile).catch(()=>{})
    const params=new URLSearchParams({search,page:'1',page_size:active==='Staff'?'5':'100'})
    if(category) params.set('category',category)
    request<Page<Staff>>('staff?'+params.toString(),token).then(r=>{setStaff(r.items);setStaffTotal(r.total)}).catch(e=>setMessage(e.message))
  },[active,search,category,token,refreshKey])

  async function choosePaymentStudent(student:StudentMatch){
    setSelectedPaymentStudent(student)
    setStudentMatches([])
    setFeeSearch('')
    setShowPaymentForm(true)
    setSelectedStudentCharges([])
    setPayment({charge_id:'',amount:'',method:'Cash',reference:''})
    setMessage('Loading this student’s fee charges...')
    try {
      const rows=await request<Charge[]>('finance/charges?search='+encodeURIComponent(student.admission_number),token)
      const ownRows=rows.filter(row=>row.student_id===student.id)
      setSelectedStudentCharges(ownRows)
      setMessage(ownRows.length?'Student selected. Choose the term charge below.':'This student is registered, but no fee charge exists yet. Set the class fee structure or assign the term fee first.')
    } catch(error) {
      setMessage(error instanceof Error?error.message:'Unable to load this student’s fee charges.')
    }
  }

  async function refreshFinance(){
    const params=new URLSearchParams({search:feeSearch,outstanding_only:String(outstandingOnly)})
    if(feeClass) params.set('class_id',feeClass)
    const [s,rows,balances]=await Promise.all([
      request<Summary>('finance/summary',token),
      request<Charge[]>('finance/charges?'+params.toString(),token),
      request<Charge[]>('finance/charges?outstanding_only=true',token)
    ])
    setSummary(s);setCharges(rows);setAllOutstanding(balances)
  }
  useEffect(()=>{if(active==='Fees & Finance'){refreshFinance().catch(e=>setMessage(e.message));request<any>('settings/school-profile',token).then(setSchoolProfile).catch(()=>{})}},[active,feeSearch,feeClass,outstandingOnly,token,refreshKey])
  useEffect(()=>{if(active!=='Fees & Finance'||financeTab!=='payments'||!feeSearch.trim()){setStudentMatches([]);return}const params=new URLSearchParams({search:feeSearch,page:'1',page_size:'5'});request<Page<StudentMatch>>('students/search?'+params.toString(),token).then(r=>setStudentMatches(r.items)).catch(e=>setMessage(e.message))},[active,financeTab,feeSearch,token,refreshKey])

  useEffect(()=>{
    if(active!=='Fees & Finance'||!feeSetup.class_id)return
    request<{fees:{term:string;amount:number;boarding_amount?:number;day_amount?:number}[]}>('classes/'+feeSetup.class_id+'/fees?year='+feeSetup.year,token)
      .then(data=>setFeeSetup(old=>{const fee=data.fees.find(x=>x.term===old.term);return {...old,boarding_amount:String(fee?.boarding_amount??fee?.amount??0),day_amount:String(fee?.day_amount??fee?.amount??0)}}))
      .catch(e=>setMessage(e.message))
  },[active,feeSetup.class_id,feeSetup.term,feeSetup.year,token])

  async function saveClassFee(e:FormEvent){
    e.preventDefault()
    if(!feeSetup.class_id || !feeSetup.term || !feeSetup.year || !feeSetup.boarding_amount.trim() || !feeSetup.day_amount.trim() || !Number.isInteger(Number(feeSetup.boarding_amount)) || !Number.isInteger(Number(feeSetup.day_amount)) || Number(feeSetup.boarding_amount)<0 || Number(feeSetup.day_amount)<0){setMessage('Enter valid whole-number fees for both boarding and day students.');return}
    setSavingFee(true);setMessage('')
    try{
      await request('classes/'+feeSetup.class_id+'/fees',token,{method:'PUT',body:JSON.stringify({term:feeSetup.term,year:Number(feeSetup.year),boarding_amount:Number(feeSetup.boarding_amount),day_amount:Number(feeSetup.day_amount)})})
      setShowFeeForm(false)
      setMessage('Class fee structure saved.')
      await refreshFinance()
    }catch(e){setMessage(e instanceof Error?e.message:'Unable to save class fee.')}
    finally{setSavingFee(false)}
  }

  const selectedStaffSubjects=form.subjects.split(',').map(value=>value.trim()).filter(Boolean)
  function toggleStaffSubject(name:string){
    const selected=new Set(selectedStaffSubjects)
    if(selected.has(name)) selected.delete(name); else selected.add(name)
    setForm({...form,subjects:subjectOptions.filter(item=>selected.has(item.name)).map(item=>item.name).join(', ')})
  }

  async function addStaff(e:FormEvent){
    e.preventDefault()
    const missingStaffFields = [
      !form.full_name.trim() || form.full_name.trim().split(/\s+/).length < 2 ? 'Full name (first and last name)' : '',
      !form.category ? 'Staff category' : '',
      !form.position.trim() ? 'Job title / position' : '',
      !form.department.trim() ? 'Department' : '',
      form.category === 'Teaching' && !selectedStaffSubjects.length ? 'At least one registered subject' : '',
    ].filter(Boolean)
    if(missingStaffFields.length){setMessage('Cannot save staff member. Complete: '+missingStaffFields.join(', ')+'.');return}
    setMessage('');setSavingStaff(true)
    try {
      const payload={...(()=>{const names=form.full_name.trim().split(/\s+/);return {first_name:names.shift()||'',last_name:names.join(' ')||'—'}})(),...form,house:form.house||null,salary_amount:form.salary_amount===''?null:Number(form.salary_amount),subjects:form.category==='Teaching'?form.subjects:null}
      if(editingStaff){
        await request('staff/'+editingStaff,token,{method:'PATCH',body:JSON.stringify(payload)})
        setMessage('Staff profile updated.')
        setNewStaffLogin(null)
      }else{
        const created=await request<{staff:Staff;login:{username:string;email:string;temporary_passcode:string}}>('staff',token,{method:'POST',body:JSON.stringify(payload)})
        setNewStaffLogin({name:form.full_name,...created.login})
        setMessage('Staff member registered and login account created. Copy the temporary passcode now; it will not be shown again.')
      }
      setEditingStaff(null);setForm(emptyStaffForm);setShowForm(false)
      const p=new URLSearchParams({search,page:'1',page_size:'5'});if(category)p.set('category',category);const r=await request<Page<Staff>>('staff?'+p.toString(),token);setStaff(r.items);setStaffTotal(r.total)
    }
    catch(e){setMessage(e instanceof Error?e.message:'Unable to save staff member.')}
    finally{setSavingStaff(false)}
  }
  async function archiveStaff(id:number){
    if(!window.confirm('Archive this staff member? Their records and salary history will be retained.')) return
    try {await request('staff/'+id+'/archive',token,{method:'POST'});setMessage('Staff member archived.');const p=new URLSearchParams({search,page:'1',page_size:'5'});if(category)p.set('category',category);const r=await request<Page<Staff>>('staff?'+p.toString(),token);setStaff(r.items);setStaffTotal(r.total)}
    catch(e){setMessage(e instanceof Error?e.message:'Unable to archive staff member.')}
  }
  async function saveOtherExpense(e:FormEvent){
    e.preventDefault();setMessage('');setSavingExpense(true)
    try {await request('finance/other-expenses',token,{method:'POST',body:JSON.stringify({...expenseForm,amount:Number(expenseForm.amount),reference:expenseForm.reference||null})});setExpenseForm({description:'',category:'General',amount:'',reference:''});setShowExpenseForm(false);setMessage('Expense recorded.');await refreshFinance()}
    catch(e){setMessage(e instanceof Error?e.message:'Unable to record expense.')}
    finally{setSavingExpense(false)}
  }
  async function saveSalaryPayment(e:FormEvent){
    e.preventDefault();setMessage('');setSavingSalary(true)
    try {await request('finance/salary-payments',token,{method:'POST',body:JSON.stringify({...salaryForm,staff_id:Number(salaryForm.staff_id),amount:Number(salaryForm.amount),reference:salaryForm.reference||null})});setSalaryForm({staff_id:'',amount:'',period:'',reference:''});setShowSalaryForm(false);setMessage('Salary payment recorded.');await refreshFinance()}
    catch(e){setMessage(e instanceof Error?e.message:'Unable to record salary payment.')}
    finally{setSavingSalary(false)}
  }
  function printReminders(){
    const rows=charges.filter(c=>c.balance>0)
    const entities:Record<string,string>={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}
    const escape=(value:string)=>value.replace(/[&<>"']/g,ch=>entities[ch]||ch)
    const content=rows.map(c=>'<tr><td>'+escape(c.student_name)+'</td><td>'+escape(c.admission_number)+'</td><td>'+escape((c.class_name||'')+' '+(c.stream||''))+'</td><td>'+escape(c.term+' '+c.year)+'</td><td>UGX '+c.balance.toLocaleString()+'</td></tr>').join('')
    const page=window.open('','_blank')
    if(!page){setMessage('Allow pop-ups to print fee reminders.');return}
    page.document.write('<!doctype html><html><head><title>Outstanding fee reminders</title><style>body{font-family:Arial,sans-serif;padding:28px}h1{font-size:22px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #bbb;padding:9px;text-align:left}th{background:#eee}</style></head><body><h1>Outstanding Fee Balances</h1><p>SchoolBridge · '+new Date().toLocaleDateString()+'</p><table><thead><tr><th>Student</th><th>Admission number</th><th>Class / Stream</th><th>Term</th><th>Balance</th></tr></thead><tbody>'+content+'</tbody></table></body></html>')
    page.document.close();page.focus();page.print()
  }
  async function adjustCharge(charge:Charge){
    const value=window.prompt('Enter the revised total fee amount in UGX:',String(charge.amount))
    if(value===null)return
    const amount=Number(value)
    if(!Number.isInteger(amount)||amount<0){setMessage('Enter a valid whole-number UGX amount.');return}
    const reason=window.prompt('Why is this fee charge being adjusted?')
    if(!reason||reason.trim().length<3){setMessage('A reason is required for the audit record.');return}
    try {await request('finance/charges/'+charge.id,token,{method:'PATCH',body:JSON.stringify({amount,reason:reason.trim()})});setMessage('Fee charge adjusted and audit record saved.');await refreshFinance()}
    catch(e){setMessage(e instanceof Error?e.message:'Unable to adjust fee charge.')}
  }
  async function saveOfflinePayment(){
    if(!selectedPaymentStudent||!payment.charge_id||!Number.isInteger(Number(payment.amount))||Number(payment.amount)<=0){setOfflineFinanceStatus('Select a student charge and enter a valid whole-number amount.');return}
    if(offlineFinancePassphrase.length<12){setOfflineFinanceStatus('Enter a passphrase of at least 12 characters.');return}
    setOfflineFinanceBusy(true);setOfflineFinanceStatus('')
    try{
      const loginIndex=JSON.parse(localStorage.getItem('schoolbridge-offline-login-index')||'null') as {userId:number;deviceId:string}|null
      if(!loginIndex||!Number.isInteger(loginIndex.userId)||!loginIndex.deviceId)throw new Error('Download a current encrypted offline snapshot while connected before preparing offline payments.')
      const userId=loginIndex.userId,deviceId=loginIndex.deviceId
      if(localStorage.getItem('schoolbridge-sync-device-'+userId)!==deviceId)throw new Error('The registered device identity has changed. Revalidate this browser online.')
      const metaRaw=localStorage.getItem('schoolbridge-offline-snapshot-meta-'+userId+'-'+deviceId)
      if(!metaRaw)throw new Error('Download a current encrypted offline snapshot before preparing payments.')
      const meta=JSON.parse(metaRaw) as {sequence:number}
      if(!Number.isInteger(meta.sequence)||meta.sequence<0)throw new Error('The offline snapshot sequence is invalid. Download it again.')
      const charge=selectedStudentCharges.find(item=>item.id===Number(payment.charge_id))
      if(!charge)throw new Error('The selected fee charge is unavailable.')
      const item:OfflineFinancePayment={idempotency_key:crypto.randomUUID(),charge_id:charge.id,amount:Number(payment.amount),method:payment.method,reference:payment.reference||null,payment_date:new Date().toISOString().slice(0,10),base_sequence:meta.sequence,student_name:[selectedPaymentStudent.first_name,selectedPaymentStudent.middle_name,selectedPaymentStudent.last_name].filter(Boolean).join(' '),admission_number:selectedPaymentStudent.admission_number,term:charge.term,year:charge.year}
      const existing=await loadEncryptedFinanceQueue<OfflineFinancePayment[]>(userId,deviceId,offlineFinancePassphrase)
      const next=[...existing,item];await saveEncryptedFinanceQueue(userId,deviceId,offlineFinancePassphrase,next)
      setOfflineFinanceQueue(next);setOfflineFinanceStatus('Payment securely queued. It has NOT been recorded by the school yet.')
    }catch(error){setOfflineFinanceStatus(error instanceof Error?error.message:'Unable to save offline payment.')}
    finally{setOfflineFinanceBusy(false)}
  }
  async function loadOfflineFinanceDrafts(){
    if(offlineFinancePassphrase.length<12){setOfflineFinanceStatus('Enter the passphrase used to protect the queue.');return}
    setOfflineFinanceBusy(true);setOfflineFinanceStatus('')
    try{
      const loginIndex=JSON.parse(localStorage.getItem('schoolbridge-offline-login-index')||'null') as {userId:number;deviceId:string}|null
      if(!loginIndex||!Number.isInteger(loginIndex.userId)||!loginIndex.deviceId)throw new Error('No registered offline snapshot is available on this browser.')
      if(localStorage.getItem('schoolbridge-sync-device-'+loginIndex.userId)!==loginIndex.deviceId)throw new Error('The registered device identity has changed. Revalidate this browser online.')
      const queue=await loadEncryptedFinanceQueue<OfflineFinancePayment[]>(loginIndex.userId,loginIndex.deviceId,offlineFinancePassphrase)
      setOfflineFinanceQueue(queue)
      setOfflineFinanceStatus(queue.length+' saved payment(s) loaded. Review pending entries before synchronising.')
    }catch(error){setOfflineFinanceStatus(error instanceof Error?error.message:'Unable to load offline payments.')}
    finally{setOfflineFinanceBusy(false)}
  }
  async function discardOfflineFinanceDraft(idempotencyKey:string){
    if(!window.confirm('Remove this unsynchronised payment draft from this device? This does not reverse any payment already accepted by the school.'))return
    if(offlineFinancePassphrase.length<12){setOfflineFinanceStatus('Enter the queue passphrase before removing a draft.');return}
    setOfflineFinanceBusy(true);setOfflineFinanceStatus('')
    try{
      const loginIndex=JSON.parse(localStorage.getItem('schoolbridge-offline-login-index')||'null') as {userId:number;deviceId:string}|null
      if(!loginIndex||localStorage.getItem('schoolbridge-sync-device-'+loginIndex.userId)!==loginIndex.deviceId)throw new Error('Revalidate this registered device online before changing its queue.')
      const queue=await loadEncryptedFinanceQueue<OfflineFinancePayment[]>(loginIndex.userId,loginIndex.deviceId,offlineFinancePassphrase)
      const next=queue.filter(item=>item.idempotency_key!==idempotencyKey)
      await saveEncryptedFinanceQueue(loginIndex.userId,loginIndex.deviceId,offlineFinancePassphrase,next)
      setOfflineFinanceQueue(next)
      setOfflineFinanceStatus('Draft removed from this device. No school payment was recorded or reversed.')
    }catch(error){setOfflineFinanceStatus(error instanceof Error?error.message:'Unable to remove offline payment draft.')}
    finally{setOfflineFinanceBusy(false)}
  }
  async function syncOfflinePayments(){
    if(offlineFinancePassphrase.length<12){setOfflineFinanceStatus('Enter the passphrase used to protect the queue.');return}
    setOfflineFinanceBusy(true);setOfflineFinanceStatus('')
    try{
      const loginIndex=JSON.parse(localStorage.getItem('schoolbridge-offline-login-index')||'null') as {userId:number;deviceId:string}|null
      if(!loginIndex||!Number.isInteger(loginIndex.userId)||!loginIndex.deviceId)throw new Error('No registered offline snapshot is available on this browser.')
      const userId=loginIndex.userId,deviceId=loginIndex.deviceId
      if(localStorage.getItem('schoolbridge-sync-device-'+userId)!==deviceId)throw new Error('The registered device identity has changed. Revalidate this browser online.')
      const queue=await loadEncryptedFinanceQueue<OfflineFinancePayment[]>(userId,deviceId,offlineFinancePassphrase)
      const remaining:OfflineFinancePayment[]=[];let applied=0,conflicts=0
      for(const item of queue){try{const result=await request<{status:string}>('sync/finance-payments',token,{method:'POST',body:JSON.stringify({device_id:deviceId,idempotency_key:item.idempotency_key,charge_id:item.charge_id,amount:item.amount,method:item.method,reference:item.reference,payment_date:item.payment_date,base_sequence:item.base_sequence})});if(result.status==='applied')applied++;else{conflicts++;remaining.push(item)}}catch(error){remaining.push(item);if(error instanceof Error&&error.message.includes('409'))conflicts++}}
      await saveEncryptedFinanceQueue(userId,deviceId,offlineFinancePassphrase,remaining);setOfflineFinanceQueue(remaining)
      setOfflineFinanceStatus(applied+' payment(s) synchronised; '+conflicts+' conflict(s) retained for review; '+remaining.length+' remain queued.')
      if(applied)await refreshFinance()
    }catch(error){setOfflineFinanceStatus(error instanceof Error?error.message:'Unable to synchronise offline payments.')}
    finally{setOfflineFinanceBusy(false)}
  }
  async function pay(e:FormEvent){
    e.preventDefault();setMessage('');setSavingPayment(true)
    try { const saved=await request<{receipt_number:string;amount:number;payment_date:string}>('finance/payments',token,{method:'POST',body:JSON.stringify({charge_id:Number(payment.charge_id),amount:Number(payment.amount),method:payment.method,reference:payment.reference||null})});const charge=selectedStudentCharges.find(c=>c.id===Number(payment.charge_id));if(charge)setReceipt({receipt_number:saved.receipt_number,charge,amount:saved.amount,method:payment.method,date:saved.payment_date});setPayment({charge_id:'',amount:'',method:'Cash',reference:''});setShowPaymentForm(false);setSelectedPaymentStudent(null);setSelectedStudentCharges([]);setStudentMatches([]);setMessage('Payment recorded. Receipt generated.');await refreshFinance() }
    catch(e){setMessage(e instanceof Error?e.message:'Unable to record payment.')}
    finally{setSavingPayment(false)}
  }

  if(active==='Staff') return <section className="panel">
    <div className="panel-heading"><div><h2>Staff directory</h2><p>{staffTotal} staff members · teaching and non-teaching</p></div>{canAddStaff&&<button className="primary-button add-student-button" onClick={()=>{if(showForm){setShowForm(false);setEditingStaff(null)}else{setEditingStaff(null);setForm(emptyStaffForm);setMessage('');setShowForm(true)}}}><Plus size={16}/>{showForm?'Close form':'Add staff member'}</button>}</div>
    {message&&<div className="success-notice">{message}</div>}
    {newStaffLogin&&<div className="success-notice staff-login-handover"><strong>Staff login created — hand these details to {newStaffLogin.name}</strong><p>Username: <b>{newStaffLogin.username}</b></p><p>Email / account ID: <b>{newStaffLogin.email}</b></p><p>Temporary passcode: <b>{newStaffLogin.temporary_passcode}</b></p><p>Ask the staff member to change the passcode after signing in. This passcode is shown only once.</p><button type="button" className="secondary-button" onClick={()=>{void navigator.clipboard?.writeText('SchoolBridge login\\nUsername: '+newStaffLogin.username+'\\nTemporary passcode: '+newStaffLogin.temporary_passcode)}}>Copy login details</button><button type="button" className="secondary-button" onClick={()=>setNewStaffLogin(null)}>I have saved these details</button></div>}
    {showForm&&<form className="student-form registration-form" onSubmit={addStaff}>
      <div className="form-heading"><div><h3>{editingStaff?'Update staff profile':'Register a staff member'}</h3><p>Enter the employee's details. Fields marked * are compulsory.</p></div><span className="required-note">* Required</span></div>
      <section className="form-section"><div className="form-section-heading"><span className="form-section-number">01</span><div><h4>Biodata</h4><p>Enter the employee's full legal name.</p></div></div><div className="student-form-grid"><label className="field-span-full">Full name *<input autoComplete="name" required value={form.full_name} onChange={e=>setForm({...form,full_name:e.target.value})} placeholder="Enter employee's full name"/></label></div></section>
      <section className="form-section"><div className="form-section-heading"><span className="form-section-number">02</span><div><h4>Professional information</h4><p>Set the employee's category, school role, department and teaching subjects.</p></div></div><div className="student-form-grid">
        <label>Staff category *<select required value={form.category} onChange={e=>setForm({...form,category:e.target.value})}><option>Teaching</option><option>Non-teaching</option></select></label>
        <label>Job title / position *<input required list="school-staff-roles" value={form.position} onChange={e=>setForm({...form,position:e.target.value})} placeholder="Choose or type a role"/><datalist id="school-staff-roles">{(form.category==='Teaching'?['Head Teacher','Deputy Head Teacher','Director of Studies','Class Teacher','Subject Teacher','Senior Teacher','Head of Department','Examinations Officer','Guidance and Counselling Teacher','Special Needs Teacher']:['School Administrator','Bursar','Accountant','Secretary','Librarian','Laboratory Technician','ICT Technician','Nurse','Matron','Warden','Driver','Security Officer','Cook','Cleaner','Groundskeeper','Storekeeper','Procurement Officer']).map(x=><option key={x} value={x}/>)}</datalist></label>
        <label>Department *<input required list="school-departments" value={form.department} onChange={e=>setForm({...form,department:e.target.value})} placeholder="Choose or type a department"/><datalist id="school-departments">{['Administration','Academics','Languages','Sciences','Humanities','Mathematics','ICT','Examinations','Finance and Accounts','Human Resources','Library','Laboratory','Student Affairs','Guidance and Counselling','Sports and Games','Health Services','Catering','Transport','Maintenance','Security','Boarding'].map(x=><option key={x} value={x}/>)}</datalist></label>
        {form.category==='Teaching'&&<div className="field-span-full staff-subject-picker"><div className="staff-subject-picker-heading"><strong>Subjects this teacher is qualified to teach *</strong><span>{selectedStaffSubjects.length} selected</span></div><p className="field-hint">Select every subject assigned to this teacher during registration. You can select more than one. Only these subjects will be available when assigning classes.</p><div className="permission-choice-grid staff-subject-choice-grid">{subjectOptions.map(subject=><button type="button" key={subject.id} className={selectedStaffSubjects.includes(subject.name)?'permission-choice active':'permission-choice'} aria-pressed={selectedStaffSubjects.includes(subject.name)} onClick={()=>toggleStaffSubject(subject.name)}><span>{subject.name}</span><small>{selectedStaffSubjects.includes(subject.name)?'Selected':'Select subject'}</small></button>)}</div>{!subjectOptions.length&&<small className="field-hint">No registered subjects are available. Add subjects under Examinations before registering a subject teacher.</small>}{!selectedStaffSubjects.length&&<small className="field-error">Select at least one subject for this teaching staff member.</small>}</div>}
      </div></section>
      <section className="form-section"><div className="form-section-heading"><span className="form-section-number">03</span><div><h4>Contact information</h4><p>How the school can contact this employee.</p></div></div><div className="student-form-grid">
        <label>House<select value={form.house} onChange={e=>setForm({...form,house:e.target.value})}><option value="">Select house (optional)</option>{(schoolProfile as any).house_names?.split(/\r?\n/).map((h:string)=>h.trim()).filter(Boolean).map((h:string)=><option key={h}>{h}</option>)}</select></label>
        <label>Phone number<input type="tel" autoComplete="tel" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="e.g. 07XX XXX XXX"/></label>
        <label>Email address<input type="email" autoComplete="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="name@example.com"/></label>
      </div></section>
      <section className="form-section"><div className="form-section-heading"><span className="form-section-number">04</span><div><h4>Salary arrangement</h4><p>Optional payroll reference details for this employee.</p></div></div><div className="student-form-grid">
        <label>Salary amount (UGX)<input type="number" min="0" step="1" value={form.salary_amount} onChange={e=>setForm({...form,salary_amount:e.target.value})} placeholder="Optional"/></label>
        <label>Pay frequency<select value={form.salary_frequency} onChange={e=>setForm({...form,salary_frequency:e.target.value})}><option>Monthly</option><option>Termly</option><option>Weekly</option><option>Daily</option></select></label>
      </div></section>
      <div className="form-actions"><button type="button" className="secondary-button" onClick={()=>{setShowForm(false);setEditingStaff(null)}}>Cancel</button><button className="primary-button" disabled={savingStaff}>{savingStaff?'Saving staff...':editingStaff?'Update staff profile':'Register staff member'}</button></div>
    </form>}
    <div className="table-tools student-tools"><div className="search-box"><Search size={17}/><input placeholder="Search name or staff number..." value={search} onChange={e=>setSearch(e.target.value)}/></div><div className="staff-category-options" role="group" aria-label="Filter staff category">{[{label:'All staff',value:''},{label:'Teaching',value:'Teaching'},{label:'Non-teaching',value:'Non-teaching'}].map(option=><button key={option.value||'all'} type="button" className={category===option.value?'staff-category-option active':'staff-category-option'} onClick={()=>setCategory(option.value)}>{option.label}</button>)}</div></div>
    <p className="staff-list-count">Showing {staff.length} of {staffTotal} staff members{search.trim()?' matching your search':'. Search to find other staff members.'}</p>
    <div className="table-wrap"><table><thead><tr><th>Staff member</th><th>Staff number</th><th>Category</th><th>Position</th><th>Department</th><th>House</th><th>Phone</th><th>Salary (UGX)</th><th>Status</th><th>Actions</th></tr></thead><tbody>{staff.map(s=><tr key={s.id}><td>{s.first_name} {s.last_name}</td><td>{s.staff_number}</td><td>{s.category}</td><td>{s.position||'—'}{s.subjects?' · '+s.subjects:''}</td><td>{s.department||'—'}</td><td>{s.house||'—'}</td><td>{s.phone||'—'}</td><td>{s.salary_amount?.toLocaleString()||'—'} {s.salary_frequency||''}</td><td>{s.status||'active'}</td><td><button type="button" className="secondary-button" onClick={()=>{setEditingStaff(s.id);setForm({full_name:[s.first_name,s.last_name].filter(Boolean).join(' '),category:s.category,position:s.position||'',department:s.department||'',subjects:s.subjects||'',phone:s.phone||'',email:s.email||'',salary_amount:s.salary_amount==null?'':String(s.salary_amount),salary_frequency:s.salary_frequency||'Monthly',house:s.house||''});setShowForm(true)}}>Edit</button>{s.status!=='archived'&&<button type="button" className="secondary-button" onClick={()=>void archiveStaff(s.id)}>Archive</button>}</td></tr>)}</tbody></table></div>
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
    <div className="finance-toolbar"><div className="finance-tabs">
      {(['overview','payments','balances','expenses','fees'] as const).map(tab=><button key={tab} type="button" className={financeTab===tab?'finance-tab active':'finance-tab'} onClick={()=>setFinanceTab(tab)}>{({overview:'Overview',payments:'Payments',balances:'Outstanding balances',expenses:'Expenses',fees:'Fee structure'} as const)[tab]}</button>)}
    </div><button className="secondary-button" type="button" onClick={()=>void refreshFinance().catch(e=>setMessage(e.message))}><RefreshCw size={15}/> Refresh</button></div>
    {financeTab==='overview'&&<div className="finance-overview"><h3>Finance at a glance</h3><p>Review collections, balances and expenses, or open a workspace below.</p><div className="finance-shortcuts"><button onClick={()=>setFinanceTab('payments')}>Record a payment</button><button onClick={()=>setFinanceTab('balances')}>View class balances</button><button onClick={()=>setFinanceTab('expenses')}>Manage expenses</button><button onClick={()=>setFinanceTab('fees')}>Configure class fees</button></div></div>}
    {financeTab==='payments'&&<>
    <div className="panel-heading"><div><h2>Find a student</h2><p>Search the student register by name or admission number, then select the student to continue.</p></div></div>
    <div className="table-tools"><div className="search-box"><Search size={17}/><input placeholder="Enter student name or admission number..." value={feeSearch} onChange={e=>{setFeeSearch(e.target.value);setSelectedPaymentStudent(null);setShowPaymentForm(false);setPayment({charge_id:'',amount:'',method:'Cash',reference:''})}}/></div></div>
    {!selectedPaymentStudent&&feeSearch.trim()&&<div className="finance-search-results"><div className="panel-heading"><div><h3>Matching students</h3><p>{studentMatches.length} students found · Select any row to continue</p></div></div><div className="table-wrap"><table><thead><tr><th>Student</th><th>Admission no.</th><th>Class</th><th>Status</th></tr></thead><tbody>{studentMatches.map(student=><tr key={student.id} className="clickable-row" onClick={()=>void choosePaymentStudent(student)} style={{cursor:'pointer'}}><td>{[student.first_name,student.middle_name,student.last_name].filter(Boolean).join(' ')}</td><td>{student.admission_number}</td><td>{classes.find(cls=>cls.id===student.class_id)?.name||'—'} {classes.find(cls=>cls.id===student.class_id)?.section||''}</td><td>{student.status||'active'}</td></tr>)}</tbody></table></div>{!studentMatches.length&&<p className="empty-state">{feeSearch.trim().length<2?'Enter at least two characters to search.':'No registered students match this name or admission number. Try the full admission number or another part of the student name.'}</p>}</div>}
    <div className="panel-heading"><div><h2>Record a payment</h2><p>{selectedPaymentStudent?'Confirm the selected student and record the payment.':'Search for a student, then select their result to continue.'}</p></div>{selectedPaymentStudent&&<button type="button" className="secondary-button" onClick={()=>{setSelectedPaymentStudent(null);setSelectedStudentCharges([]);setShowPaymentForm(false);setPayment({charge_id:'',amount:'',method:'Cash',reference:''});setMessage('Search for another student.')}}>Change student</button>}</div>
    {showPaymentForm&&selectedPaymentStudent&&<form className="student-form registration-form" onSubmit={pay}>
      <div className="form-heading"><div><h3>Receive a student payment</h3><p>Selected: {[selectedPaymentStudent.first_name,selectedPaymentStudent.middle_name,selectedPaymentStudent.last_name].filter(Boolean).join(' ')} · {selectedPaymentStudent.admission_number}. Confirm the term charge before recording money received.</p></div></div>
      <section className="form-section"><div className="form-section-heading"><span className="form-section-number">01</span><div><h4>Payment allocation</h4><p>Always confirm the student's name, admission number and term.</p></div></div><div className="student-form-grid">
        <label className="field-span-full">Student term charge *<select required value={payment.charge_id} onChange={e=>setPayment({...payment,charge_id:e.target.value})}><option value="">Select an outstanding charge</option>{selectedStudentCharges.filter(c=>c.balance>0).map(c=><option key={c.id} value={c.id}>{c.term} {c.year} · Balance UGX {c.balance.toLocaleString()}</option>)}</select><small className="field-hint">{selectedStudentCharges.some(c=>c.balance>0)?'Select the term whose balance you are paying.':'No outstanding fee charge is available for this student yet.'}</small></label>
        <label>Amount received (UGX) *<input type="number" min="1" step="1" required value={payment.amount} onChange={e=>setPayment({...payment,amount:e.target.value})} placeholder="Enter amount received"/></label>
        <label>Payment method<select value={payment.method} onChange={e=>setPayment({...payment,method:e.target.value})}><option>Cash</option><option>Bank</option><option>Mobile Money</option><option>Cheque</option></select></label>
        <label className="field-span-full">Reference / transaction ID<input value={payment.reference} onChange={e=>setPayment({...payment,reference:e.target.value})} placeholder="Optional bank or mobile money reference"/></label>
      </div></section>
      <div className="form-actions"><button className="primary-button" disabled={savingPayment||!selectedStudentCharges.some(c=>c.balance>0)||!payment.charge_id||Number(payment.amount)<=0}>{savingPayment?'Recording payment...':'Record payment and issue receipt'}</button><button type="button" className="secondary-button" disabled={offlineFinanceBusy||!payment.charge_id||Number(payment.amount)<=0} onClick={()=>void saveOfflinePayment()}><LockKeyhole size={15}/> Save encrypted offline draft</button></div>
      <section className="form-section"><div className="form-section-heading"><span className="form-section-number">OFFLINE</span><div><h4>Offline payment queue</h4><p>Encrypted on this browser. Drafts expire after 24 hours. A queued item is not a receipt or confirmed payment until accepted by the server.</p></div></div><label className="field-span-full">Offline queue passphrase<input type="password" autoComplete="off" value={offlineFinancePassphrase} onChange={e=>setOfflineFinancePassphrase(e.target.value)} placeholder="At least 12 characters"/></label><div className="form-actions"><button type="button" className="secondary-button" disabled={offlineFinanceBusy} onClick={()=>void loadOfflineFinanceDrafts()}>Load saved queue</button><button type="button" className="secondary-button" disabled={offlineFinanceBusy} onClick={()=>void syncOfflinePayments()}><CloudUpload size={15}/> Synchronise queued payments</button><span>{offlineFinanceQueue.length} loaded draft(s)</span></div>{offlineFinanceQueue.length>0&&<div className="table-wrap"><table><thead><tr><th>Student</th><th>Admission no.</th><th>Term</th><th>Amount (UGX)</th><th>Action</th></tr></thead><tbody>{offlineFinanceQueue.map(item=><tr key={item.idempotency_key}><td>{item.student_name}</td><td>{item.admission_number}</td><td>{item.term} {item.year}</td><td>{item.amount.toLocaleString()}</td><td><button type="button" className="secondary-button" disabled={offlineFinanceBusy} onClick={()=>void discardOfflineFinanceDraft(item.idempotency_key)}>Remove draft</button></td></tr>)}</tbody></table></div>}{offlineFinanceStatus&&<p className="field-hint" role="status">{offlineFinanceStatus}</p>}</section>
    </form>}
    {receipt&&<section className="panel receipt-print"><div className="panel-heading"><div><h2>{schoolProfile.name||'SchoolBridge'}</h2><p>Official fee payment receipt · {schoolProfile.phone||''} {schoolProfile.email||''}</p></div><button className="secondary-button" type="button" onClick={()=>window.print()}>Print receipt</button></div><div className="receipt-details"><strong>Receipt: {receipt.receipt_number}</strong><p>Student: {receipt.charge.student_name}</p><p>Admission number: {receipt.charge.admission_number}</p><p>Class: {receipt.charge.class_name||'—'} {receipt.charge.stream||''}</p><p>Fee: {receipt.charge.term} {receipt.charge.year}</p><p>Amount received: UGX {receipt.amount.toLocaleString()}</p><p>Payment method: {receipt.method}</p><p>Date: {receipt.date}</p></div></section>}
    </>}
    {financeTab==='expenses'&&<>
    <div className="panel-heading"><div><h2>Staff salary payments</h2><p>Record payments made to school employees.</p></div><button type="button" className="primary-button" onClick={()=>setShowSalaryForm(v=>!v)}>{showSalaryForm?'Close form':'Record salary payment'}</button></div>
    {showSalaryForm&&<form className="student-form registration-form" onSubmit={saveSalaryPayment}><div className="form-section"><div className="form-section-heading"><span className="form-section-number">01</span><div><h4>Salary payment details</h4><p>Select the employee and identify the period this payment covers.</p></div></div><div className="student-form-grid"><label className="field-span-full">Staff member *<select required value={salaryForm.staff_id} onChange={e=>setSalaryForm({...salaryForm,staff_id:e.target.value})}><option value="">Select an active staff member</option>{staff.filter(x=>x.status!=='archived').map(x=><option key={x.id} value={x.id}>{x.first_name} {x.last_name} · {x.staff_number}</option>)}</select></label><label>Amount (UGX) *<input required type="number" min="1" step="1" value={salaryForm.amount} onChange={e=>setSalaryForm({...salaryForm,amount:e.target.value})} placeholder="Amount paid"/></label><label>Salary period *<input required placeholder="e.g. November 2026" value={salaryForm.period} onChange={e=>setSalaryForm({...salaryForm,period:e.target.value})}/></label><label className="field-span-full">Payment reference<input value={salaryForm.reference} onChange={e=>setSalaryForm({...salaryForm,reference:e.target.value})} placeholder="Optional bank or transaction reference"/></label></div></div><div className="form-actions"><button className="primary-button" disabled={savingSalary||!salaryForm.staff_id||Number(salaryForm.amount)<=0||!salaryForm.period.trim()}>{savingSalary?'Recording salary...':'Record salary payment'}</button></div></form>}
    <div className="panel-heading"><div><h2>Other school expenses</h2><p>Record purchases, utilities, maintenance and other costs.</p></div><button type="button" className="primary-button" onClick={()=>setShowExpenseForm(v=>!v)}>{showExpenseForm?'Close form':'Record expense'}</button></div>
    {showExpenseForm&&<form className="student-form registration-form" onSubmit={saveOtherExpense}><div className="form-section"><div className="form-section-heading"><span className="form-section-number">01</span><div><h4>Expense details</h4><p>Record what the school paid for and keep a clear reference.</p></div></div><div className="student-form-grid"><label className="field-span-full">Description *<input required value={expenseForm.description} onChange={e=>setExpenseForm({...expenseForm,description:e.target.value})} placeholder="e.g. Classroom stationery"/></label><label>Category<select value={expenseForm.category} onChange={e=>setExpenseForm({...expenseForm,category:e.target.value})}><option>General</option><option>Utilities</option><option>Supplies</option><option>Maintenance</option><option>Transport</option><option>Other</option></select></label><label>Amount (UGX) *<input required type="number" min="1" step="1" value={expenseForm.amount} onChange={e=>setExpenseForm({...expenseForm,amount:e.target.value})} placeholder="Amount paid"/></label><label className="field-span-full">Payment reference<input value={expenseForm.reference} onChange={e=>setExpenseForm({...expenseForm,reference:e.target.value})} placeholder="Optional receipt or transaction reference"/></label></div></div><div className="form-actions"><button className="primary-button" disabled={savingExpense||!expenseForm.description.trim()||Number(expenseForm.amount)<=0}>{savingExpense?'Recording expense...':'Record school expense'}</button></div></form>}
    </>}
    {financeTab==='balances'&&<>
    <div className="panel-heading"><div><h2>Outstanding balances by class</h2><p>Select a class to see students with unpaid balances.</p></div></div>
    <div className="finance-class-grid">
      {classes.map(cls=>{const rows=allOutstanding.filter(x=>x.class_id===cls.id&&x.balance>0);const total=rows.reduce((sum,x)=>sum+x.balance,0);return <button type="button" key={cls.id} className={feeClass===String(cls.id)?'finance-class-card selected':'finance-class-card'} onClick={()=>{setFeeClass(String(cls.id));setFeeSearch('');setOutstandingOnly(true)}}><Building2 size={20}/><strong>{cls.name}{cls.section?' — '+cls.section:''}</strong><span>{rows.length} students with balances</span><b>UGX {total.toLocaleString()}</b></button>})}
    </div>
    <div className="panel-heading"><div><h2>{feeClass?'Selected class balances':'All class balances'}</h2><p>{feeClass?'Students with outstanding balances in this class':'Choose a class above to narrow the list.'}</p></div><button type="button" className="secondary-button" onClick={()=>setFeeClass('')}>All classes</button></div>
    <div className="table-tools"><button type="button" className={outstandingOnly?'choice-toggle active':'choice-toggle'} aria-pressed={outstandingOnly} onClick={()=>setOutstandingOnly(value=>!value)}>Outstanding only · {outstandingOnly?'On':'Off'}</button><button className="secondary-button" type="button" onClick={printReminders}>Print reminders</button></div>
    <div className="table-wrap"><table><thead><tr><th>Student</th><th>Admission no.</th><th>Term</th><th>Year</th><th>Charged (UGX)</th><th>Paid (UGX)</th><th>Balance (UGX)</th><th>Action</th></tr></thead><tbody>{charges.map(c=><tr key={c.id}><td>{c.student_name}</td><td>{c.admission_number}</td><td>{c.term}</td><td>{c.year}</td><td>{c.amount.toLocaleString()}</td><td>{c.paid.toLocaleString()}</td><td><strong>{c.balance.toLocaleString()}</strong></td><td><button type="button" className="secondary-button" onClick={()=>void adjustCharge(c)}>Adjust</button></td></tr>)}</tbody></table></div>
    {!charges.length&&<div className="empty-state"><Wallet size={30}/><p>No fee charges match the selected class or search.</p></div>}
    </>}
    {financeTab==='fees'&&<section className="student-form finance-fee-setup"><div className="panel-heading"><div><h2>Class fee structure</h2><p>Set separate term charges for boarding and day students in each class.</p></div><button type="button" className="primary-button" onClick={()=>setShowFeeForm(v=>!v)}>{showFeeForm?'Close form':'Configure class fee'}</button></div>{showFeeForm&&<form className="registration-form" onSubmit={saveClassFee}><div className="form-section"><div className="form-section-heading"><span className="form-section-number">01</span><div><h4>Class fee configuration</h4><p>Configure different charges for boarders and day scholars for this class, term and year.</p></div></div><div className="student-form-grid"><label>Class / stream *<select required value={feeSetup.class_id} onChange={e=>setFeeSetup({...feeSetup,class_id:e.target.value})}><option value="">Choose class</option>{classes.map(c=><option key={c.id} value={c.id}>{c.name}{c.section?' — '+c.section:''}</option>)}</select></label><label>Term *<select required value={feeSetup.term} onChange={e=>setFeeSetup({...feeSetup,term:e.target.value})}><option>Term 1</option><option>Term 2</option><option>Term 3</option></select></label><label>Academic year *<input required type="number" min="2000" max="2100" value={feeSetup.year} onChange={e=>setFeeSetup({...feeSetup,year:e.target.value})}/></label><label>Boarding fee (UGX) *<input required type="number" min="0" step="1" value={feeSetup.boarding_amount} onChange={e=>setFeeSetup({...feeSetup,boarding_amount:e.target.value})} placeholder="Boarding student fee"/></label><label>Day scholar fee (UGX) *<input required type="number" min="0" step="1" value={feeSetup.day_amount} onChange={e=>setFeeSetup({...feeSetup,day_amount:e.target.value})} placeholder="Day student fee"/></label></div></div><div className="form-actions"><button className="primary-button" disabled={savingFee||!feeSetup.class_id||feeSetup.boarding_amount===''||feeSetup.day_amount===''||Number(feeSetup.boarding_amount)<0||Number(feeSetup.day_amount)<0}>{savingFee?'Saving fee...':'Save class fee'}</button></div></form>}</section>}
  </section>
  return null
}
