import './App.css'

export default function SchoolAccessLanding({schoolId,schoolName}:{schoolId:string;schoolName:string}) {
  const base = window.location.origin + '/?school=' + encodeURIComponent(schoolId)
  return <main className="login-page school-access-page">
    <section className="login-card school-access-card">
      <div className="brand-mark">SB</div>
      <div className="brand-name">School<span>Bridge</span></div>
      <p className="login-subtitle">{schoolName} · Official access page</p>
      <h1>Welcome to {schoolName}</h1>
      <p className="muted">Choose the access route for your role.</p>
      <div className="school-access-actions">
        <a className="primary-button" href={base + '&audience=parent'}>Parent access</a>
        <a className="primary-button" href={base + '&audience=teacher'}>Teacher access</a>
        <a className="secondary-button" href={base + '&audience=staff'}>Administrator &amp; essential staff sign in</a>
        <a className="desktop-download-link" href="https://github.com/christian-official/schoolbridge-ug/releases/latest" target="_blank" rel="noreferrer">Download SchoolBridge for Windows</a>
      </div>
      <p className="login-foot">Secure access for the {schoolName} community</p>
    </section>
  </main>
}
