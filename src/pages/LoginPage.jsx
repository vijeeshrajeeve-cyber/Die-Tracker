import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, ChevronDown, Eye, EyeOff, HelpCircle, Layers, LoaderCircle, LockKeyhole, UserRound } from 'lucide-react';
import { APP_NAME } from '../utils/constants';
import { BRAND } from '../utils/brand';
import '../styles/login.css';

// A lightweight, decorative extrusion drawing keeps the welcome screen tied to
// the work itself. It uses no external image, canvas runtime, or animation loop.
function ExtrusionDrawing() {
  return (
    <svg className="login-extrusion" viewBox="0 0 560 350" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="login-metal-top" x1="165" y1="130" x2="330" y2="45" gradientUnits="userSpaceOnUse">
          <stop stopColor="#A6BBCB" /><stop offset="0.45" stopColor="#E2EAF0" /><stop offset="1" stopColor="#889DAF" />
        </linearGradient>
        <linearGradient id="login-metal-side" x1="295" y1="175" x2="460" y2="140" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7F96A9" /><stop offset="0.42" stopColor="#B4C6D3" /><stop offset="1" stopColor="#647E93" />
        </linearGradient>
        <linearGradient id="login-metal-face" x1="135" y1="130" x2="295" y2="295" gradientUnits="userSpaceOnUse">
          <stop stopColor="#EAF0F4" /><stop offset="0.55" stopColor="#B2C3D0" /><stop offset="1" stopColor="#E0E8EE" />
        </linearGradient>
        <linearGradient id="login-metal-inner" x1="166" y1="172" x2="263" y2="263" gradientUnits="userSpaceOnUse">
          <stop stopColor="#112637" /><stop offset="1" stopColor="#4F6B81" />
        </linearGradient>
      </defs>

      <g stroke="#7C9BB3" strokeOpacity="0.22" strokeWidth="1">
        <path d="M64 282 302 163 511 267M97 307 335 188M138 329 376 210M61 249 269 353M94 232 302 336M127 215 335 319M160 198 368 302M193 181 401 285M226 164 434 268" />
        <path d="M78 117H112M95 100V134M456 279H490M473 262V296" strokeOpacity="0.6" />
      </g>
      <path d="m135 298 164 13 171-91-148-42Z" fill="#06121F" fillOpacity="0.3" />

      {/* The long top and side faces of a hollow aluminium profile. */}
      <path d="m135 132 166-82h153l-159 82Z" fill="url(#login-metal-top)" stroke="#D5E0E8" strokeWidth="1.2" />
      <path d="m295 132 159-82v163l-159 82Z" fill="url(#login-metal-side)" stroke="#A8BDCD" strokeWidth="1.2" />
      <g strokeWidth="1.5">
        <path d="M155 132l164-82M168 132l163-82M262 132l161-82M276 132l160-82" stroke="#6F889D" />
        <path d="M158 132l164-82M265 132l161-82" stroke="#E6EDF2" />
        <path d="M295 152l159-82M295 163l159-82M295 264l159-82M295 276l159-82" stroke="#4A657B" />
        <path d="M295 155l159-82M295 267l159-82" stroke="#C1D1DC" />
      </g>

      {/* Recessed opening and the machined front face. */}
      <path d="M164 162h102v103H164Z" fill="url(#login-metal-inner)" />
      <path d="m164 162 35 18h67v-18ZM164 162v103l35-18v-67Z" fill="#122A3D" />
      <path d="m164 265 35-18h67v18Z" fill="#7892A6" />
      <path d="M141 132h148a6 6 0 0 1 6 6v151a6 6 0 0 1-6 6H141a6 6 0 0 1-6-6V138a6 6 0 0 1 6-6Zm33 32a9 9 0 0 0-9 9v81a9 9 0 0 0 9 9h82a9 9 0 0 0 9-9v-81a9 9 0 0 0-9-9Z" fill="url(#login-metal-face)" fillRule="evenodd" stroke="#DFE8EF" strokeWidth="1.5" />
      <path d="M174 164h82a9 9 0 0 1 9 9v81a9 9 0 0 1-9 9h-82a9 9 0 0 1-9-9v-81a9 9 0 0 1 9-9Z" stroke="#6D869A" strokeWidth="2" />
      <g fill="#243E53" stroke="#8AA2B5" strokeWidth="2">
        <circle cx="151" cy="148" r="6" /><circle cx="279" cy="148" r="6" />
        <circle cx="151" cy="279" r="6" /><circle cx="279" cy="279" r="6" />
      </g>
      <g fill="#29455B" stroke="#839CAE" strokeWidth="1">
        <path d="M205 132v8h-7v8h34v-8h-7v-8M205 295v-8h-7v-8h34v8h-7v8M135 204h8v-7h8v34h-8v-7h-8M295 204h-8v-7h-8v34h8v-7h8" />
      </g>

      <g stroke="#83A6BF" strokeWidth="1" strokeOpacity="0.65">
        <path d="M115 132H87M115 295H87M95 132v163M91 136l8-8M91 299l8-8" />
        <path d="M311 307v19M465 227v19M312 319l151-79M309 315l6 8M460 236l6 8" />
        <path d="M389 86V27h54" strokeDasharray="3 4" />
        <circle cx="389" cy="86" r="3" fill="#87B6D5" stroke="none" />
      </g>
      <g fill="#9AB4C8" fontFamily="'JetBrains Mono', monospace" fontSize="9" letterSpacing="1.5">
        <text x="448" y="30">01 / PROFILE</text>
        <text x="54" y="224" transform="rotate(-90 54 224)">PRECISION</text>
        <text x="335" y="337">BUILT TO PERFORM</text>
      </g>
    </svg>
  );
}

export default function LoginPage({ form, setForm, passwordVisible, setPasswordVisible, error, loading, onSubmit }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const passwordRef = useRef(null);
  const describedBy = error ? 'login-error' : undefined;

  // A failed sign-in clears the password in the shell; put the cursor back there.
  useEffect(() => {
    if (error && !loading) passwordRef.current?.focus();
  }, [error, loading]);

  const trackCapsLock = (event) => {
    if (typeof event.getModifierState === 'function') setCapsLockOn(event.getModifierState('CapsLock'));
  };

  return (
    <main className="login-page" style={{ '--login-primary': BRAND.navy }}>
      <div className="login-shell">
        <section className="login-story" aria-labelledby="login-story-title">
          <header className="login-story-header">
            <img className="login-company-logo" src="/company-logo.png" alt="Gulf Extrusion" width="154" height="91" />
            <span className="login-workspace-label">DIE OPERATIONS</span>
          </header>

          <div className="login-story-content">
            <p className="login-eyebrow"><span /> PRECISION AT EVERY STAGE</p>
            <p id="login-story-title" className="login-story-title">Every die.{' '}<br />Every detail.{' '}<br /><span>In one place.</span></p>
            <p className="login-story-description">From the first drawing to the factory floor.<br className="login-desktop-break" /> Keep your die orders moving, together.</p>
            <ExtrusionDrawing />
          </div>

          <footer className="login-story-footer">
            {/* The same marker on every stage, so the strip reads as a sequence, not a status. */}
            <div className="login-process" role="img" aria-label="Design, then order, then produce">
              <span><i className="login-process-dot" /> Design</span>
              <span className="login-process-line" />
              <span><i className="login-process-dot" /> Order</span>
              <span className="login-process-line" />
              <span><i className="login-process-dot" /> Produce</span>
            </div>
            <span className="login-story-caption">ONE CONNECTED WORKFLOW</span>
          </footer>
        </section>

        <section className="login-access" aria-labelledby="login-title">
          <header className="login-product">
            <span className="login-product-icon"><Layers size={21} strokeWidth={1.65} aria-hidden="true" /></span>
            <span>{APP_NAME}</span>
          </header>

          <div className="login-form-container">
            <div className="login-form-heading">
              <p className="login-form-eyebrow">YOUR WORKSPACE AWAITS</p>
              <h1 id="login-title">Welcome back.</h1>
              <p>Sign in to keep things moving.</p>
            </div>

            <form className="login-form" onSubmit={onSubmit} aria-busy={loading}>
              <div className="login-field">
                <label htmlFor="dieorderingsystem-username">Username</label>
                <div className="login-input-wrap">
                  <UserRound size={18} className="login-input-icon" aria-hidden="true" />
                  <input
                    id="dieorderingsystem-username"
                    name="username"
                    type="text"
                    value={form.username}
                    onChange={(event) => setForm({ ...form, username: event.target.value })}
                    placeholder="Enter your username"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    readOnly={loading}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={describedBy}
                    required
                  />
                </div>
              </div>

              <div className="login-field">
                <label htmlFor="dieorderingsystem-password">Password</label>
                <div className="login-input-wrap">
                  <LockKeyhole size={18} className="login-input-icon" aria-hidden="true" />
                  <input
                    id="dieorderingsystem-password"
                    name="password"
                    type={passwordVisible ? 'text' : 'password'}
                    value={form.password}
                    onChange={(event) => setForm({ ...form, password: event.target.value })}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    readOnly={loading}
                    ref={passwordRef}
                    onKeyDown={trackCapsLock}
                    onKeyUp={trackCapsLock}
                    onBlur={() => setCapsLockOn(false)}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={[capsLockOn && 'login-caps', describedBy].filter(Boolean).join(' ') || undefined}
                    required
                  />
                  <button
                    className="login-reveal"
                    type="button"
                    onClick={() => setPasswordVisible((visible) => !visible)}
                    aria-label={passwordVisible ? 'Hide password' : 'Show password'}
                    aria-controls="dieorderingsystem-password"
                    aria-pressed={passwordVisible}
                  >
                    {passwordVisible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                  </button>
                </div>
                {capsLockOn && <p id="login-caps" className="login-caps" role="status">Caps Lock is on</p>}
              </div>

              {error && (
                <div id="login-error" className="login-error" role="alert">
                  <AlertCircle size={18} aria-hidden="true" />
                  <p>{error}</p>
                </div>
              )}

              <button className="login-submit" type="submit" disabled={loading}>
                <span aria-live="polite">{loading ? 'Signing in…' : 'Sign in'}</span>
                {loading ? <LoaderCircle className="login-spinner" size={18} data-spinner aria-hidden="true" /> : <ArrowRight size={18} aria-hidden="true" />}
              </button>

              <div className="login-help">
                <button className="login-help-toggle no-press" type="button" aria-expanded={helpOpen} aria-controls="login-help-content" onClick={() => setHelpOpen((open) => !open)}>
                  <HelpCircle size={15} aria-hidden="true" />
                  Need help signing in?
                  <ChevronDown size={14} aria-hidden="true" className={helpOpen ? 'login-help-chevron is-open' : 'login-help-chevron'} />
                </button>
                <div id="login-help-content" className="login-help-content" hidden={!helpOpen}>
                  Contact your system administrator to request an account or reset your password. Use your assigned username to sign in.
                </div>
              </div>
            </form>

            <div className="login-access-note">
              <LockKeyhole size={15} aria-hidden="true" />
              <p>Access is limited to authorized team members.</p>
            </div>
          </div>

          <footer className="login-access-footer">
            <span>Gulf Extrusion</span>
            <span className="login-footer-dot" aria-hidden="true">·</span>
            <span>Die Operations Workspace</span>
          </footer>
        </section>
      </div>
    </main>
  );
}
