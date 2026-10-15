import { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, ChevronDown, Eye, EyeOff, HelpCircle, Layers, LoaderCircle, LockKeyhole, UserRound } from 'lucide-react';
import { APP_NAME } from '../utils/constants';
import '../styles/login.css';

// "Remember this workstation" keeps only the username on this device. The
// password and the session itself are never stored here.
const REMEMBERED_USERNAME_KEY = 'login.rememberedUsername';

function readRememberedUsername() {
  try {
    return window.localStorage.getItem(REMEMBERED_USERNAME_KEY) || '';
  } catch {
    return '';
  }
}

function writeRememberedUsername(username) {
  try {
    if (username) window.localStorage.setItem(REMEMBERED_USERNAME_KEY, username);
    else window.localStorage.removeItem(REMEMBERED_USERNAME_KEY);
  } catch {
    // Storage blocked (private window, policy): the checkbox simply has no effect.
  }
}

const circle = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

// Cross-sections of three aluminium profiles, each drawn in a 100-unit box and
// filled even-odd so the inner paths become the hollows.
const PROFILES = {
  hollow: {
    height: 70,
    d: 'M0 0H100V12H94V58H100V70H0V58H6V12H0Z M14 14H46V56H14Z M54 14H86V56H54Z',
  },
  beam: {
    height: 100,
    d: `M0 0H100V16H60V84H100V100H0V84H40V16H0Z ${circle(50, 30, 5)} ${circle(50, 70, 5)}`,
  },
  square: {
    height: 100,
    d: 'M0 0H42V6H36V12H64V6H58V0H100V42H94V36H88V64H94V58H100V100H58V94H64V88H36V94H42V100H0V58H6V64H12V36H6V42H0Z '
      + `M28 28H72V72H28Z ${circle(18, 18, 5)} ${circle(82, 18, 5)} ${circle(18, 82, 5)} ${circle(82, 82, 5)}`,
  },
};

// The extrusion is the cross-section stacked back along the depth vector, far
// layers darker, so the hollows show their inner walls without any 3D runtime.
const DEPTH_STEPS = 48;
const STEP = [2, -1.25];
const FAR = [62, 84, 104];
const NEAR = [159, 179, 196];

function layerColor(i) {
  const t = 1 - i / DEPTH_STEPS;
  const [r, g, b] = FAR.map((far, k) => Math.round(far + (NEAR[k] - far) * t));
  return `rgb(${r} ${g} ${b})`;
}

function ProfileDrawing({ shape, className }) {
  const id = `login-profile-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const { height, d } = PROFILES[shape];
  const depthX = DEPTH_STEPS * STEP[0];
  const depthY = DEPTH_STEPS * STEP[1];

  return (
    <svg className={`login-profile ${className}`} viewBox={`-36 ${depthY - 34} ${100 + depthX + 74} ${height - depthY + 66}`} fill="none" aria-hidden="true">
      <defs>
        <path id={`${id}-shape`} d={d} fillRule="evenodd" />
        <linearGradient id={`${id}-face`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#EEF3F7" /><stop offset="0.55" stopColor="#AFC1CF" /><stop offset="1" stopColor="#DCE5EC" />
        </linearGradient>
      </defs>

      {Array.from({ length: DEPTH_STEPS }, (_, k) => {
        const i = DEPTH_STEPS - k;
        return <use key={i} href={`#${id}-shape`} fill={layerColor(i)} transform={`translate(${i * STEP[0]} ${i * STEP[1]})`} />;
      })}
      <use href={`#${id}-shape`} transform={`translate(${depthX} ${depthY})`} stroke="#A9BFD0" strokeOpacity="0.5" strokeWidth="0.6" />
      <use href={`#${id}-shape`} fill={`url(#${id}-face)`} stroke="#E4ECF2" strokeWidth="0.8" />

      <g stroke="#8FB0C8" strokeWidth="0.6" strokeOpacity="0.6">
        {/* Height dimension, length dimension, a leader to the label and two registration marks. */}
        <path d={`M-20 0H-8M-20 ${height}H-8M-14 0V${height}M-17 3l6-6M-17 ${height + 3}l6-6`} />
        <path d={`M0 ${height + 8}V${height + 18}M${depthX} ${height + depthY + 8}V${height + depthY + 18}M0 ${height + 14}L${depthX} ${height + depthY + 14}`} />
        <path d={`M${100 + depthX} ${depthY}V${depthY - 22}H${100 + depthX - 34}`} strokeDasharray="2 2.5" />
        <path d={`M${100 + depthX + 22} ${height / 2 + depthY - 8}h12m-6 -6v12M-28 ${height + 26}h10m-5 -5v10`} />
      </g>
      <g fill="#9AB4C8" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="6" letterSpacing="1">
        <text x={100 + depthX - 34} y={depthY - 26} textAnchor="end">01 / PROFILE</text>
        <text x="-24" y={height / 2} textAnchor="middle" transform={`rotate(-90 -24 ${height / 2})`}>PRECISION</text>
        <text x={depthX * 0.55} y={height + depthY * 0.55 + 26}>BUILT TO PERFORM</text>
      </g>
    </svg>
  );
}

export default function LoginPage({ form, setForm, passwordVisible, setPasswordVisible, error, loading, onSubmit }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [remember, setRemember] = useState(() => readRememberedUsername() !== '');
  const passwordRef = useRef(null);
  const describedBy = error ? 'login-error' : undefined;

  // Prefill a remembered username once, without overwriting anything typed.
  useEffect(() => {
    const remembered = readRememberedUsername();
    if (remembered) setForm((current) => (current.username ? current : { ...current, username: remembered }));
  }, [setForm]);

  // A failed sign-in clears the password in the shell; put the cursor back there.
  useEffect(() => {
    if (error && !loading) passwordRef.current?.focus();
  }, [error, loading]);

  const trackCapsLock = (event) => {
    if (typeof event.getModifierState === 'function') setCapsLockOn(event.getModifierState('CapsLock'));
  };

  const handleSubmit = (event) => {
    writeRememberedUsername(remember ? form.username.trim() : '');
    onSubmit(event);
  };

  return (
    <main className="login-page">
      <div className="login-backdrop" aria-hidden="true" />
      <div className="login-decor" aria-hidden="true">
        <ProfileDrawing shape="hollow" className="login-profile--top" />
        <ProfileDrawing shape="beam" className="login-profile--side" />
        <ProfileDrawing shape="square" className="login-profile--bottom" />
        <ProfileDrawing shape="hollow" className="login-profile--corner" />
      </div>

      <div className="login-layout">
        <section className="login-card" aria-labelledby="login-title">
          <header className="login-card-header">
            <img className="login-company-logo" src="/company-logo.png" alt="Gulf Extrusion" width="154" height="91" />
            <span className="login-card-divider" aria-hidden="true" />
            <span className="login-workspace-label">DIE OPERATIONS</span>
          </header>

          <div className="login-form-heading">
            <p className="login-form-eyebrow">YOUR WORKSPACE AWAITS</p>
            <h1 id="login-title">Welcome back.</h1>
            <p>Sign in to keep things moving.</p>
          </div>

          <form className="login-form" onSubmit={handleSubmit} aria-busy={loading}>
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

            <div className="login-options">
              <label className="login-remember">
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                Remember this workstation
              </label>
              <button className="login-help-toggle no-press" type="button" aria-expanded={helpOpen} aria-controls="login-help-content" onClick={() => setHelpOpen((open) => !open)}>
                <HelpCircle size={15} aria-hidden="true" />
                Need help signing in?
                <ChevronDown size={14} aria-hidden="true" className={helpOpen ? 'login-help-chevron is-open' : 'login-help-chevron'} />
              </button>
            </div>
            <div id="login-help-content" className="login-help-content" hidden={!helpOpen}>
              Contact your system administrator to request an account or reset your password. Use your assigned username to sign in.
            </div>
          </form>

          <div className="login-access-note">
            <LockKeyhole size={15} aria-hidden="true" />
            <p>Access is limited to authorized team members.</p>
          </div>
        </section>

        <section className="login-story" aria-labelledby="login-story-title">
          <div className="login-product">
            <span className="login-product-icon"><Layers size={21} strokeWidth={1.65} aria-hidden="true" /></span>
            <span>{APP_NAME}</span>
          </div>

          <div className="login-story-content">
            <p id="login-story-title" className="login-story-title">Every die.{' '}<br />Every detail.{' '}<br /><span>In one place.</span></p>
            <p className="login-story-description">From the first drawing to the factory floor.<br className="login-desktop-break" /> Keep your die orders moving, together.</p>
          </div>

          <div className="login-story-footer">
            {/* The same marker on every stage, so the strip reads as a sequence, not a status. */}
            <div className="login-process" role="img" aria-label="Design, then order, then produce">
              <span><i className="login-process-dot" /> Design</span>
              <span className="login-process-line" />
              <span><i className="login-process-dot" /> Order</span>
              <span className="login-process-line" />
              <span><i className="login-process-dot" /> Produce</span>
            </div>
            <span className="login-story-caption">ONE CONNECTED WORKFLOW</span>
          </div>

          <footer className="login-page-footer">
            <span>Gulf Extrusion</span>
            <span className="login-footer-dot" aria-hidden="true">·</span>
            <span>Die Operations Workspace</span>
          </footer>
        </section>
      </div>
    </main>
  );
}
