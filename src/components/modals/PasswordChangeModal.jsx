import React, { useState } from 'react';
import { Key, Lock, ShieldCheck, X, Eye, AlertTriangle, CheckCircle } from 'lucide-react';
import { authAPI } from '../../api';

const inputStyle = {
  width: '100%',
  padding: '12px 40px 12px 12px',
  background: '#0F172A',
  border: '1px solid #334155',
  borderRadius: '8px',
  color: '#F1F5F9',
  fontSize: '0.95rem'
};

// Moved outside to prevent re-creation on every render
const PasswordInput = ({ name, label, value, show, onToggle, onChange }) => (
  <div style={{ marginBottom: '1rem' }}>
    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, color: '#94A3B8', marginBottom: '6px' }}>
      {label}
    </label>
    <div style={{ position: 'relative' }}>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        style={inputStyle}
        required
      />
      <button
        type="button"
        onClick={onToggle}
        style={{
          position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
          background: 'transparent', border: 'none', color: '#64748B', cursor: 'pointer'
        }}
      >
        <Eye size={18} />
      </button>
    </div>
  </div>
);

function PasswordChangeModal({ onClose, onSuccess, isForced = false }) {
  const [formData, setFormData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false
  });

  const passwordRequirements = [
    { label: 'At least 8 characters', test: (p) => p.length >= 8 },
    { label: 'Contains uppercase letter', test: (p) => /[A-Z]/.test(p) },
    { label: 'Contains lowercase letter', test: (p) => /[a-z]/.test(p) },
    { label: 'Contains number', test: (p) => /[0-9]/.test(p) },
  ];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (formData.newPassword !== formData.confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    const unmetRequirements = passwordRequirements.filter(r => !r.test(formData.newPassword));
    if (unmetRequirements.length > 0) {
      setError('Password does not meet all requirements');
      return;
    }

    setLoading(true);
    try {
      await authAPI.changePassword(formData.currentPassword, formData.newPassword);
      onSuccess();
    } catch (err) {
      setError(err.message || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (name) => (e) => {
    setFormData(prev => ({ ...prev, [name]: e.target.value }));
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '1rem'
      }}
      onClick={isForced ? undefined : onClose}
    >
      <div
        style={{
          background: '#1E293B', borderRadius: '20px', width: '100%', maxWidth: '440px',
          border: '1px solid #334155', overflow: 'hidden'
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.5rem', borderBottom: '1px solid #334155' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '48px', height: '48px', borderRadius: '14px',
              background: isForced ? 'linear-gradient(135deg, #F59E0B, #EF4444)' : 'linear-gradient(135deg, #3B82F6, #8B5CF6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              {isForced ? <ShieldCheck size={24} color="white" /> : <Key size={24} color="white" />}
            </div>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#F1F5F9' }}>
                {isForced ? 'Password Change Required' : 'Change Password'}
              </h2>
              <p style={{ fontSize: '0.875rem', color: '#64748B' }}>
                {isForced ? 'You must change your password to continue' : 'Update your account password'}
              </p>
            </div>
          </div>
          {!isForced && (
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#64748B', cursor: 'pointer', padding: '8px', borderRadius: '8px' }}>
              <X size={24} />
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '1.5rem' }}>
          {error && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              background: 'rgba(244,63,94,0.1)', color: '#F43F5E',
              padding: '0.875rem 1rem', borderRadius: '10px', marginBottom: '1rem'
            }}>
              <AlertTriangle size={18} />
              <span style={{ fontSize: '0.9rem' }}>{error}</span>
            </div>
          )}

          {isForced && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: '10px',
              background: 'rgba(245,158,11,0.1)', padding: '1rem',
              borderRadius: '10px', marginBottom: '1.25rem'
            }}>
              <Lock size={18} color="#F59E0B" style={{ marginTop: '2px', flexShrink: 0 }} />
              <p style={{ fontSize: '0.85rem', color: '#F59E0B', lineHeight: 1.5 }}>
                For security reasons, you must change your default password before accessing the system.
              </p>
            </div>
          )}

          <PasswordInput
            name="currentPassword"
            label="Current Password"
            value={formData.currentPassword}
            show={showPasswords.current}
            onToggle={() => setShowPasswords(prev => ({ ...prev, current: !prev.current }))}
            onChange={handleInputChange('currentPassword')}
          />

          <PasswordInput
            name="newPassword"
            label="New Password"
            value={formData.newPassword}
            show={showPasswords.new}
            onToggle={() => setShowPasswords(prev => ({ ...prev, new: !prev.new }))}
            onChange={handleInputChange('newPassword')}
          />

          <PasswordInput
            name="confirmPassword"
            label="Confirm New Password"
            value={formData.confirmPassword}
            show={showPasswords.confirm}
            onToggle={() => setShowPasswords(prev => ({ ...prev, confirm: !prev.confirm }))}
            onChange={handleInputChange('confirmPassword')}
          />

          <div style={{ background: '#0F172A', borderRadius: '10px', padding: '1rem', marginBottom: '1.25rem' }}>
            <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748B', marginBottom: '0.5rem', textTransform: 'uppercase' }}>
              Password Requirements
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              {passwordRequirements.map((req, idx) => {
                const met = req.test(formData.newPassword);
                return (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{
                      width: '16px', height: '16px', borderRadius: '50%',
                      background: met ? '#10B981' : '#334155',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      {met && <CheckCircle size={10} color="white" />}
                    </div>
                    <span style={{ fontSize: '0.75rem', color: met ? '#10B981' : '#64748B' }}>
                      {req.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '14px',
              background: loading ? '#475569' : 'linear-gradient(135deg, #3B82F6, #8B5CF6)',
              color: 'white', border: 'none', borderRadius: '10px',
              fontWeight: 600, fontSize: '1rem', cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
            }}
          >
            {loading ? (
              <>
                <div style={{
                  width: '18px', height: '18px', border: '2px solid rgba(255,255,255,0.3)',
                  borderTopColor: 'white', borderRadius: '50%', animation: 'spin 1s linear infinite'
                }} />
                Changing Password...
              </>
            ) : (
              <>
                <Key size={18} />
                Change Password
              </>
            )}
          </button>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </form>
      </div>
    </div>
  );
}

export default PasswordChangeModal;
