import React, { useState, useMemo } from 'react';
import { X, Eye, EyeOff, Shield, KeyRound, AlertTriangle, CheckCircle } from 'lucide-react';

import useDialog from '../../hooks/useDialog';
const PASSWORD_RULES = [
  { label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { label: 'Contains uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { label: 'Contains lowercase letter', test: (p) => /[a-z]/.test(p) },
  { label: 'Contains number', test: (p) => /[0-9]/.test(p) },
];

const generateTempPassword = () => {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  const pick = (set) => set[Math.floor(Math.random() * set.length)];
  let pwd = pick(upper) + pick(lower) + pick(digits);
  for (let i = 0; i < 9; i++) pwd += pick(all);
  return pwd.split('').sort(() => Math.random() - 0.5).join('');
};

const ResetPasswordModal = ({ user, onClose, onSubmit }) => {
  const dialogRef = useDialog({ open: true, onClose });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const rules = useMemo(() => PASSWORD_RULES.map(r => ({ ...r, met: r.test(password) })), [password]);
  const allMet = rules.every(r => r.met);
  const mismatch = confirm.length > 0 && confirm !== password;

  const handleGenerate = () => {
    const pwd = generateTempPassword();
    setPassword(pwd);
    setConfirm(pwd);
    setShowPassword(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!allMet) { setError('Password does not meet all requirements'); return; }
    if (password !== confirm) { setError('Passwords do not match'); return; }
    setLoading(true);
    try {
      await onSubmit(password);
    } catch (err) {
      setError(err.message || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', zIndex: 1000, padding: '20px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#0c1425', borderRadius: '20px', width: '100%', maxWidth: '480px',
          border: '1px solid #1e293b', boxShadow: '0 25px 80px rgba(0,0,0,0.5)', overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '16px 24px', borderBottom: '1px solid #1e293b',
        }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '4px 14px', borderRadius: '20px',
            border: '1px solid #b45309', color: '#fbbf24',
            fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            <Shield size={12} /> Admin Password Reset
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '6px 14px', borderRadius: '8px',
              background: 'transparent', border: '1px solid #334155',
              color: '#94a3b8', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500,
            }}
          >
            Close <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <div style={{
              width: '44px', height: '44px', borderRadius: '12px',
              background: 'linear-gradient(135deg, #F59E0B, #EF4444)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <KeyRound size={20} color="white" />
            </div>
            <div>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f1f5f9', margin: 0 }}>
                Reset password for {user?.username}
              </h2>
              <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '2px 0 0' }}>
                The user will be forced to change this password on next login.
              </p>
            </div>
          </div>

          {error && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              background: 'rgba(244,63,94,0.1)', color: '#F43F5E',
              padding: '10px 14px', borderRadius: '10px', marginBottom: '14px',
              fontSize: '0.85rem',
            }}>
              <AlertTriangle size={16} /> {error}
            </div>
          )}

          <div style={{ marginBottom: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{
                fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8',
                textTransform: 'uppercase', letterSpacing: '0.5px',
              }}>New Password</label>
              <button
                type="button"
                onClick={handleGenerate}
                style={{
                  background: 'transparent', border: '1px solid #334155',
                  color: '#94a3b8', padding: '3px 10px', borderRadius: '6px',
                  fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer',
                }}
              >
                Generate
              </button>
            </div>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter new password"
                required
                style={{
                  width: '100%', padding: '11px 44px 11px 14px',
                  background: '#0a1220', border: '1px solid #1e293b',
                  borderRadius: '10px', color: '#f1f5f9', fontSize: '0.875rem',
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute', right: '10px', top: '50%',
                  transform: 'translateY(-50%)', background: 'none',
                  border: 'none', cursor: 'pointer', color: '#64748b',
                  display: 'flex', alignItems: 'center', padding: '4px',
                }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div style={{ marginBottom: '14px' }}>
            <label style={{
              display: 'block', fontSize: '0.7rem', fontWeight: 700,
              color: '#94a3b8', marginBottom: '6px', textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>Confirm Password</label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Re-enter new password"
              required
              style={{
                width: '100%', padding: '11px 14px',
                background: '#0a1220',
                border: `1px solid ${mismatch ? '#F43F5E' : '#1e293b'}`,
                borderRadius: '10px', color: '#f1f5f9', fontSize: '0.875rem',
                outline: 'none', boxSizing: 'border-box',
              }}
            />
            {mismatch && (
              <p style={{ fontSize: '0.72rem', color: '#F43F5E', margin: '4px 0 0' }}>
                Passwords do not match
              </p>
            )}
          </div>

          <div style={{ background: '#0F172A', borderRadius: '10px', padding: '12px 14px', marginBottom: '18px' }}>
            <p style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', margin: '0 0 8px', textTransform: 'uppercase' }}>
              Password Requirements
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              {rules.map((r) => (
                <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{
                    width: '14px', height: '14px', borderRadius: '50%',
                    background: r.met ? '#10B981' : '#334155',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {r.met && <CheckCircle size={10} color="white" />}
                  </div>
                  <span style={{ fontSize: '0.72rem', color: r.met ? '#10B981' : '#64748b' }}>
                    {r.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '10px 20px', borderRadius: '10px',
                background: 'transparent', border: '1px solid #334155',
                color: '#94a3b8', cursor: 'pointer', fontWeight: 500, fontSize: '0.85rem',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !allMet || password !== confirm}
              style={{
                padding: '10px 24px', borderRadius: '10px',
                background: loading || !allMet || password !== confirm
                  ? '#475569'
                  : 'linear-gradient(135deg, #F59E0B, #EF4444)',
                border: 'none', color: 'white',
                cursor: loading || !allMet || password !== confirm ? 'not-allowed' : 'pointer',
                fontWeight: 700, fontSize: '0.85rem',
              }}
            >
              {loading ? 'Resetting…' : 'Reset password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ResetPasswordModal;
