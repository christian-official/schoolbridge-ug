import './App.css'

export default function SchoolAccessLanding({schoolId,schoolName}:{schoolId:string;schoolName:string}) {
  const base = window.location.origin + '/?school=' + encodeURIComponent(schoolId)
  return <main className="login-page school-access-page">
    <section className="login-card school-access-card">
      <div className="brand-mark">SB</div>
      <div className="brand-name">School<span>Bridge</span></div>
      <p className="login-subtitle">{schoolName} · Official access page</p>
      <h1>Welcome to {schoolName}</h1>
      <p className="muted">Choose the access route for your role. Parents, teachers, administrators and essential non-teaching staff use the SchoolBridge PWA. Each role has its own sign-in or verification route.</p>
      <div className="school-access-actions">
        <a className="primary-button" href={base + '&audience=parent'}>Parent mobile access</a>
        <a className="primary-button" href={base + '&audience=teacher'}>Teacher mobile access</a>
        <a className="secondary-button" href={base + '&audience=staff'}>Administrator / essential staff access</a>
      </div>
      <p className="form-hint">Staff can open this link on a desktop or laptop, install SchoolBridge from the browser, then sign in with school-issued credentials. No QR scanner is needed.</p>
      <p className="login-foot">Secure access for the {schoolName} community</p>
    </section>
  </main>
}
