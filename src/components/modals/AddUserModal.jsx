import React, { useState, useMemo } from 'react';
import { X, Eye, EyeOff, Shield, User, Palette, Cpu, CheckSquare, Square } from 'lucide-react';
import { CONTROLLABLE_PAGES } from '../../utils/constants';

const ROLE_CONFIG = {
  user: {
    label: 'User',
    icon: User,
    color: '#0EA5E9',
    description: 'Standard workspace access with configurable page permissions.',
    scopeLabel: 'Full workspace access',
  },
  die_designer: {
    label: 'Die Designer',
    icon: Palette,
    color: '#8B5CF6',
    description: 'Best for drawing review, design approvals, and handoff stages.',
    scopeLabel: 'Design workflow access',
  },
  simulation_engineer: {
    label: 'Simulation Engineer',
    icon: Cpu,
    color: '#F59E0B',
    description: 'Focused on simulation, revision loops, and technical validation.',
    scopeLabel: 'Simulation workflow access',
  },
  admin: {
    label: 'Admin',
    icon: Shield,
    color: '#10B981',
    description: 'Full control across the product, settings, and user management.',
    scopeLabel: 'Full workspace access',
  },
};

const AddUserModal = ({ onClose, onSubmit, theme }) => {
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'user', pageAccess: null });
  const [showPassword, setShowPassword] = useState(false);

  const flowPages = CONTROLLABLE_PAGES.filter(p => p.group === 'Process Flow');
  const nonFlowPages = CONTROLLABLE_PAGES.filter(p => !p.group);

  const enabledCount = useMemo(() => {
    if (newUser.role === 'admin' || !newUser.pageAccess) return CONTROLLABLE_PAGES.length;
    return newUser.pageAccess.length;
  }, [newUser.role, newUser.pageAccess]);

  const isPageChecked = (pageId) => {
    if (newUser.role === 'admin') return true;
    return !newUser.pageAccess || newUser.pageAccess.includes(pageId);
  };

  const togglePage = (pageId) => {
    if (newUser.role === 'admin') return;
    const current = newUser.pageAccess || CONTROLLABLE_PAGES.map(p => p.id);
    const checked = current.includes(pageId);
    const updated = checked
      ? current.filter(id => id !== pageId)
      : [...current, pageId];
    setNewUser({ ...newUser, pageAccess: updated.length === CONTROLLABLE_PAGES.length ? null : updated });
  };

  const allFlowChecked = flowPages.every(p => isPageChecked(p.id));
  const someFlowChecked = flowPages.some(p => isPageChecked(p.id));
  const flowEnabledCount = flowPages.filter(p => isPageChecked(p.id)).length;

  const toggleAllFlow = () => {
    if (newUser.role === 'admin') return;
    const current = newUser.pageAccess || CONTROLLABLE_PAGES.map(p => p.id);
    const flowIds = flowPages.map(p => p.id);
    const updated = allFlowChecked
      ? current.filter(id => !flowIds.includes(id))
      : [...new Set([...current, ...flowIds])];
    setNewUser({ ...newUser, pageAccess: updated.length === CONTROLLABLE_PAGES.length ? null : updated });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(newUser);
  };

  const roleConfig = ROLE_CONFIG[newUser.role] || ROLE_CONFIG.user;

  // Custom checkbox component
  const Checkbox = ({ checked, onChange, color = '#0EA5E9', disabled = false }) => (
    <button
      type="button"
      onClick={disabled ? undefined : onChange}
      style={{
        width: '22px', height: '22px', borderRadius: '6px', border: 'none',
        background: checked ? color : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: disabled ? 'default' : 'pointer',
        transition: 'all 0.2s',
        flexShrink: 0,
        outline: checked ? 'none' : '2px solid #334155',
        outlineOffset: '-2px',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {checked && (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 6L5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </button>
  );

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', zIndex: 1000, padding: '20px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#0c1425',
          borderRadius: '20px',
          width: '100%',
          maxWidth: '780px',
          maxHeight: '90vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid #1e293b',
          boxShadow: '0 25px 80px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Top bar */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '16px 24px', borderBottom: '1px solid #1e293b',
        }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '4px 14px', borderRadius: '20px',
            border: '1px solid #0d9488', color: '#2dd4bf',
            fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            <Shield size={12} /> User Provisioning
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '6px 14px', borderRadius: '8px',
              background: 'transparent', border: '1px solid #334155',
              color: '#94a3b8', cursor: 'pointer', fontSize: '0.8rem',
              fontWeight: 500,
            }}
          >
            Close <X size={14} />
          </button>
        </div>

        {/* Scrollable content */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '24px' }}>
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '28px' }}>

              {/* === LEFT COLUMN === */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {/* Title */}
                <div>
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f1f5f9', margin: '0 0 6px' }}>
                    Add new user
                  </h2>
                  <p style={{ fontSize: '0.82rem', color: '#64748b', margin: 0, lineHeight: 1.5 }}>
                    Create an account, assign a working role, and shape access to the exact sections this user needs.
                  </p>
                </div>

                {/* Identity Card */}
                <div style={{
                  background: '#111c30',
                  border: '1px solid #1e293b',
                  borderRadius: '16px',
                  padding: '20px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
                    <div style={{
                      width: '32px', height: '32px', borderRadius: '8px',
                      background: 'rgba(100,116,139,0.2)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <User size={16} color="#94a3b8" />
                    </div>
                    <div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#f1f5f9' }}>Identity</div>
                      <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Credentials used to sign in and own activity.</div>
                    </div>
                  </div>

                  {/* Username */}
                  <div style={{ marginBottom: '14px' }}>
                    <label style={{
                      display: 'block', fontSize: '0.7rem', fontWeight: 700,
                      color: '#94a3b8', marginBottom: '6px', textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }}>Username</label>
                    <input
                      type="text"
                      value={newUser.username}
                      onChange={e => setNewUser({ ...newUser, username: e.target.value })}
                      placeholder="Enter username"
                      required
                      style={{
                        width: '100%', padding: '11px 14px',
                        background: '#0a1220', border: '1px solid #1e293b',
                        borderRadius: '10px', color: '#f1f5f9', fontSize: '0.875rem',
                        outline: 'none', transition: 'border 0.2s',
                        boxSizing: 'border-box',
                      }}
                      onFocus={e => e.target.style.borderColor = '#334155'}
                      onBlur={e => e.target.style.borderColor = '#1e293b'}
                    />
                  </div>

                  {/* Password */}
                  <div>
                    <label style={{
                      display: 'block', fontSize: '0.7rem', fontWeight: 700,
                      color: '#94a3b8', marginBottom: '6px', textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }}>Password</label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={newUser.password}
                        onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                        placeholder="Min 6 characters"
                        required
                        minLength={6}
                        style={{
                          width: '100%', padding: '11px 44px 11px 14px',
                          background: '#0a1220', border: '1px solid #1e293b',
                          borderRadius: '10px', color: '#f1f5f9', fontSize: '0.875rem',
                          outline: 'none', transition: 'border 0.2s',
                          boxSizing: 'border-box',
                        }}
                        onFocus={e => e.target.style.borderColor = '#334155'}
                        onBlur={e => e.target.style.borderColor = '#1e293b'}
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
                </div>

                {/* Access Summary Card */}
                <div style={{
                  background: '#111c30',
                  border: '1px solid #1e293b',
                  borderRadius: '16px',
                  padding: '20px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f1f5f9' }}>Access summary</span>
                    <span style={{
                      padding: '3px 10px', borderRadius: '12px',
                      background: 'rgba(100,116,139,0.15)', fontSize: '0.72rem',
                      fontWeight: 600, color: '#94a3b8',
                    }}>
                      {enabledCount} pages
                    </span>
                  </div>
                  <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0 0 16px' }}>
                    A quick read on what this account will be able to see.
                  </p>

                  <div style={{ display: 'flex', gap: '10px' }}>
                    {/* Role badge */}
                    <div style={{
                      flex: 1, padding: '14px 16px', borderRadius: '12px',
                      background: `${roleConfig.color}15`,
                      border: `1px solid ${roleConfig.color}40`,
                    }}>
                      <div style={{ fontSize: '0.65rem', fontWeight: 700, color: roleConfig.color, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
                        ROLE
                      </div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f1f5f9' }}>
                        {roleConfig.label}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '4px', lineHeight: 1.4 }}>
                        {newUser.role === 'admin' ? 'Full control across all pages and settings.' : 'Standard workspace access with configurable page permissions.'}
                      </div>
                    </div>

                    {/* Scope badge */}
                    <div style={{
                      flex: 1, padding: '14px 16px', borderRadius: '12px',
                      background: 'rgba(139,92,246,0.08)',
                      border: '1px solid rgba(139,92,246,0.25)',
                    }}>
                      <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
                        SCOPE
                      </div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f1f5f9' }}>
                        {enabledCount === CONTROLLABLE_PAGES.length ? 'Full workspace access' : 'Restricted access'}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '4px', lineHeight: 1.4 }}>
                        {enabledCount === CONTROLLABLE_PAGES.length
                          ? 'Granular permissions are active for this account.'
                          : `${enabledCount} of ${CONTROLLABLE_PAGES.length} pages enabled.`}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* === RIGHT COLUMN === */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

                {/* Role Selection */}
                <div>
                  <div style={{
                    fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8',
                    textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px',
                  }}>
                    Role Selection
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    {Object.entries(ROLE_CONFIG).map(([roleKey, config]) => {
                      const isSelected = newUser.role === roleKey;
                      const Icon = config.icon;
                      return (
                        <button
                          key={roleKey}
                          type="button"
                          onClick={() => setNewUser({
                            ...newUser,
                            role: roleKey,
                            pageAccess: roleKey === 'admin' ? null : newUser.pageAccess,
                          })}
                          style={{
                            padding: '14px',
                            borderRadius: '12px',
                            border: isSelected
                              ? `2px solid ${config.color}`
                              : '1px solid #1e293b',
                            background: isSelected ? `${config.color}10` : '#111c30',
                            cursor: 'pointer',
                            textAlign: 'left',
                            transition: 'all 0.2s',
                            outline: 'none',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                            <Icon size={16} color={isSelected ? config.color : '#64748b'} />
                            <span style={{
                              fontSize: '0.85rem', fontWeight: 600,
                              color: isSelected ? '#f1f5f9' : '#94a3b8',
                            }}>
                              {config.label}
                            </span>
                          </div>
                          <p style={{
                            fontSize: '0.7rem', color: '#64748b',
                            margin: 0, lineHeight: 1.4,
                          }}>
                            {config.description}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Page Access */}
                <div>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    marginBottom: '12px',
                  }}>
                    <span style={{
                      fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8',
                      textTransform: 'uppercase', letterSpacing: '0.5px',
                    }}>
                      Page Access
                    </span>
                    <span style={{
                      padding: '3px 10px', borderRadius: '12px',
                      background: 'rgba(16,185,129,0.12)', fontSize: '0.72rem',
                      fontWeight: 600, color: '#34d399',
                    }}>
                      {enabledCount}/{CONTROLLABLE_PAGES.length} enabled
                    </span>
                  </div>

                  <div style={{
                    display: 'flex', flexDirection: 'column', gap: '2px',
                    maxHeight: '340px', overflowY: 'auto',
                    paddingRight: '4px',
                  }}>
                    {/* Non-grouped pages */}
                    {nonFlowPages.map(page => {
                      const checked = isPageChecked(page.id);
                      return (
                        <div
                          key={page.id}
                          onClick={() => togglePage(page.id)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '12px',
                            padding: '10px 12px', borderRadius: '10px',
                            cursor: newUser.role === 'admin' ? 'default' : 'pointer',
                            transition: 'background 0.15s',
                          }}
                          onMouseEnter={e => { if (newUser.role !== 'admin') e.currentTarget.style.background = '#111c30'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                        >
                          <Checkbox
                            checked={checked}
                            onChange={() => togglePage(page.id)}
                            disabled={newUser.role === 'admin'}
                          />
                          <div>
                            <div style={{ fontSize: '0.85rem', fontWeight: 500, color: '#f1f5f9' }}>
                              {page.label}
                            </div>
                            <div style={{ fontSize: '0.68rem', color: '#64748b' }}>
                              Workspace module
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* Process Flow group */}
                    <div
                      onClick={toggleAllFlow}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '12px',
                        padding: '10px 12px', borderRadius: '10px',
                        cursor: newUser.role === 'admin' ? 'default' : 'pointer',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => { if (newUser.role !== 'admin') e.currentTarget.style.background = '#111c30'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <Checkbox
                        checked={allFlowChecked}
                        onChange={toggleAllFlow}
                        color={someFlowChecked ? '#0EA5E9' : '#0EA5E9'}
                        disabled={newUser.role === 'admin'}
                      />
                      <div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f1f5f9' }}>
                          Process Flow
                        </div>
                        <div style={{ fontSize: '0.68rem', color: flowEnabledCount === flowPages.length ? '#34d399' : '#64748b' }}>
                          {flowEnabledCount}/{flowPages.length} stages enabled
                        </div>
                      </div>
                    </div>

                    {/* Flow sub-items */}
                    <div style={{ marginLeft: '20px', paddingLeft: '16px', borderLeft: '2px solid #1e293b' }}>
                      {flowPages.map(page => {
                        const checked = isPageChecked(page.id);
                        return (
                          <div
                            key={page.id}
                            onClick={() => togglePage(page.id)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '12px',
                              padding: '8px 12px', borderRadius: '8px',
                              cursor: newUser.role === 'admin' ? 'default' : 'pointer',
                              transition: 'background 0.15s',
                            }}
                            onMouseEnter={e => { if (newUser.role !== 'admin') e.currentTarget.style.background = '#111c30'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                          >
                            <Checkbox
                              checked={checked}
                              onChange={() => togglePage(page.id)}
                              color="#0EA5E9"
                              disabled={newUser.role === 'admin'}
                            />
                            <span style={{ fontSize: '0.82rem', color: checked ? '#e2e8f0' : '#64748b', fontWeight: 500 }}>
                              {page.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <p style={{
                    fontSize: '0.72rem', color: '#475569', margin: '12px 0 0',
                    lineHeight: 1.5,
                  }}>
                    Uncheck pages to restrict access. If everything stays enabled, the user effectively gets full workspace access.
                  </p>
                </div>
              </div>
            </div>

            {/* Footer Actions */}
            <div style={{
              display: 'flex', justifyContent: 'flex-end', gap: '12px',
              marginTop: '24px', paddingTop: '20px',
              borderTop: '1px solid #1e293b',
            }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '10px 24px', borderRadius: '10px',
                  background: 'transparent', border: '1px solid #334155',
                  color: '#94a3b8', cursor: 'pointer', fontWeight: 500,
                  fontSize: '0.85rem', transition: 'all 0.2s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#1e293b'; e.currentTarget.style.color = '#f1f5f9'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#94a3b8'; }}
              >
                Cancel
              </button>
              <button
                type="submit"
                style={{
                  padding: '10px 28px', borderRadius: '10px',
                  background: 'linear-gradient(135deg, #0ea5e9, #06b6d4)',
                  border: 'none', color: 'white', cursor: 'pointer',
                  fontWeight: 700, fontSize: '0.85rem',
                  boxShadow: '0 4px 15px rgba(14,165,233,0.35)',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 6px 20px rgba(14,165,233,0.5)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 4px 15px rgba(14,165,233,0.35)'; e.currentTarget.style.transform = 'translateY(0)'; }}
              >
                Create user
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AddUserModal;
