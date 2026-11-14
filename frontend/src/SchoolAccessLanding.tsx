import './App.css'

const WINDOWS_RELEASES_URL = 'https://github.com/christian-official/schoolbridge-ug/releases/latest'

export default function SchoolAccessLanding({schoolId,schoolName}:{schoolId:string;schoolName:string}) {
  const base = window.location.origin + '/?school=' + encodeURIComponent(schoolId)
  return <main className="login-page school-access-page">
    <section className="login-card school-access-card">
      <div className="brand-mark">SB</div>
      <div className="brand-name">School<span>Bridge</span></div>
      <p className="login-subtitle">{schoolName} · Official access page</p>
      <h1>Welcome to {schoolName}</h1>
      <p className="muted">Choose the access route for your role. Parents and teachers install the mobile app experience before completing verification. Administrators and essential non-teaching staff download the Windows desktop application.</p>
      <div className="school-access-actions">
        <a className="primary-button" href={base + '&audience=parent'}>Parent mobile access</a>
        <a className="primary-button" href={base + '&audience=teacher'}>Teacher mobile access</a>
        <a className="secondary-button" href={WINDOWS_RELEASES_URL} target="_blank" rel="noreferrer">Download SchoolBridge for Windows</a>
      </div>
      <p className="form-hint">After downloading, install and open SchoolBridge on your Windows computer, then sign in with your school-issued staff credentials. No QR scanner is needed.</p>
      <p className="login-foot">Secure access for the {schoolName} community</p>
    </section>
  </main>
}
