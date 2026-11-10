import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, GraduationCap } from 'lucide-react'

type SchoolClass = { id:number; name?:string; section?:string }
const API_BASE_URL=(import.meta.env.VITE_API_BASE_URL||'').replace(/\/$/,'')
async function request<T>(path:string,token:string,options:RequestInit={}):Promise<T>{
  const response=await fetch(`${API_BASE_URL}/api/${path}`,{...options,headers:{Authorization:`Bearer ${token}`,...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}})
  const result=await response.json().catch(()=>({}))
  if(!response.ok)throw new Error(result.detail||`Request failed: ${response.status}`)
  return result as T
}

export default function StudentPromotion({token,classes,onComplete}:{token:string;classes:SchoolClass[];onComplete:()=>void}){
  const [order,setOrder]=useState<SchoolClass[]>(classes)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  useEffect(()=>setOrder(classes),[classes])
  function move(index:number,direction:number){
    const target=index+direction
    if(target<0||target>=order.length)return
    setOrder(current=>{const next=[...current];[next[index],next[target]]=[next[target],next[index]];return next})
  }
  async function promote(){
    if(order.length<2){setError('At least two classes are required.');return}
    if(!window.confirm('Promote all active learners using this class order? Learners in the final class will be marked as graduated and their parent accounts will be deactivated if they have no other active children.'))return
    setBusy(true);setError('');setMessage('')
    try{
      const result=await request<{promoted:number;graduated:number;message:string}>('students/promote',token,{method:'POST',body:JSON.stringify({class_order:order.map(row=>row.id)})})
      setMessage(`${result.promoted} learners promoted; ${result.graduated} final-class learners graduated.`)
      onComplete()
    }catch(e){setError(e instanceof Error?e.message:'Unable to complete annual promotion.')}
    finally{setBusy(false)}
  }
  return <details className="form-disclosure student-promotion-panel">
    <summary><GraduationCap size={16}/> Annual student promotion</summary>
    <div className="student-form"><div className="form-heading"><div><h3>Set the promotion order</h3><p>Arrange classes from the lowest to the final class. Active learners move one class forward; learners in the final class graduate and disappear from active lists.</p></div></div>
      {error&&<div className="form-error" role="alert">{error}</div>}{message&&<div className="success-notice" role="status">{message}</div>}
      <ol className="promotion-order-list">{order.map((item,index)=><li key={item.id}><span><strong>{index+1}. {item.name || 'Unnamed class'}{item.section?' — '+item.section:''}</strong>{index===order.length-1&&<small>Final class · graduating learners</small>}</span><span className="form-actions"><button type="button" className="secondary-button" aria-label="Move class up" disabled={index===0||busy} onClick={()=>move(index,-1)}><ArrowUp size={14}/></button><button type="button" className="secondary-button" aria-label="Move class down" disabled={index===order.length-1||busy} onClick={()=>move(index,1)}><ArrowDown size={14}/></button></span></li>)}</ol>
      <div className="form-actions"><button type="button" className="primary-button" disabled={busy||order.length<2} onClick={()=>void promote()}>{busy?'Promoting learners…':'Run annual promotion'}</button></div>
    </div>
  </details>
}
