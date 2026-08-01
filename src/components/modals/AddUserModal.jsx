import React, { useState, useMemo } from 'react';
import { X, Eye, EyeOff, Shield, User, Palette, Cpu, CheckSquare, Square } from 'lucide-react';
import { CONTROLLABLE_PAGES } from '../../utils/constants';

import useDialog from '../../hooks/useDialog';
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

const AddUserModal = ({ onClose, onSubmit, theme, mode = 'create', initialUser = null }) => {
  const dialogRef = useDialog({ open: true, onClose });
  const isEdit = mode === 'edit';
  const [newUser, setNewUser] = useState(() => {
    if (isEdit && initialUser) {
      return {
        username: initialUser.username || '',
        password: '',
        fullName: initialUser.full_name || '',
        email: initialUser.email || '',
        phone: initialUser.phone || '',
        role: initialUser.role || 'user',
        pageAccess: initialUser.page_access ?? null,
      };
    }
    return { username: '', password: '', fullName: '', email: '', phone: '', role: 'user', pageAccess: null };
  });
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
        outline: checked ? 'none' : `2px solid ${theme.cardBorder}`,
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
    <div ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', zIndex: 1000, padding: '20px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: theme.cardBg,
          borderRadius: '20px',
          width: '100%',
          maxWidth: '780px',
          maxHeight: '90vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          border: `1px solid ${theme.cardBorder}`,
          boxShadow: '0 25px 80px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Top bar */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '16px 24px', borderBottom: `1px solid ${theme.cardBorder}`,
        }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '4px 14px', borderRadius: '20px',
            border: '1px solid #0d9488', color: '#2dd4bf',
            fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            <Shield size={12} /> {isEdit ? 'Edit User' : 'User Provisioning'}
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '6px 14px', borderRadius: '8px',
              background: 'transparent', border: `1px solid ${theme.cardBorder}`,
              color: theme.textMuted, cursor: 'pointer', fontSize: '0.8rem',
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
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: theme.text, margin: '0 0 6px' }}>
                    {isEdit ? 'Edit user' : 'Add new user'}
                  </h2>
                  <p style={{ fontSize: '0.82rem', color: theme.textDim, margin: 0, lineHeight: 1.5 }}>
                    {isEdit
                      ? 'Update this account’s role and shape access to the exact sections they should see.'
                      : 'Create an account, assign a working role, and shape access to the exact sections this user needs.'}
                  </p>
                </div>

                {/* Identity Card */}
                <div style={{
                  background: theme.inputBg,
                  border: `1px solid ${theme.cardBorder}`,
                  borderRadius: '16px',
                  padding: '20px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
                    <div style={{
                      width: '32px', height: '32px', borderRadius: '8px',
                      background: 'rgba(100,116,139,0.2)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <User size={16} color={theme.textMuted} />
                    </div>
                    <div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: theme.text }}>Identity</div>
                      <div style={{ fontSize: '0.72rem', color: theme.textDim }}>Credentials used to sign in and own activity.</div>
                    </div>
                  </div>

                  {/* Username */}
                  <div style={{ marginBottom: '14px' }}>
                    <label style={{
                      display: 'block', fontSize: '0.7rem', fontWeight: 700,
                      color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }} htmlFor="addusermodal-username">Username</label>
                    <input id="addusermodal-username"
                      type="text"
                      value={newUser.username}
                      onChange={e => setNewUser({ ...newUser, username: e.target.value })}
                      placeholder="Enter username"
                      required
                      style={{
                        width: '100%', padding: '11px 14px',
                        background: theme.inputBg, border: `1px solid ${theme.cardBorder}`,
                        borderRadius: '10px', color: theme.text, fontSize: '0.875rem',
                        outline: 'none', transition: 'border 0.2s',
                        boxSizing: 'border-box',
                      }}
                      onFocus={e => e.target.style.borderColor = theme.textDim}
                      onBlur={e => e.target.style.borderColor = theme.cardBorder}
                    />
                  </div>

                  {/* Full name */}
                  <div>
                    <label style={{
                      display: 'block', fontSize: '0.7rem', fontWeight: 700,
                      color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }} htmlFor="addusermodal-full-name-signs-their-outgoing-email">Full name <span style={{ color: theme.textDim, fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>· signs their outgoing emails</span></label>
                    <input id="addusermodal-full-name-signs-their-outgoing-email"
                      type="text"
                      value={newUser.fullName}
                      onChange={e => setNewUser({ ...newUser, fullName: e.target.value })}
                      placeholder="e.g. Jaypee Kumar"
                      style={{
                        width: '100%', padding: '11px 14px',
                        background: theme.inputBg, border: `1px solid ${theme.cardBorder}`,
                        borderRadius: '10px', color: theme.text, fontSize: '0.875rem',
                        outline: 'none', transition: 'border 0.2s',
                        boxSizing: 'border-box',
                      }}
                      onFocus={e => e.target.style.borderColor = theme.textDim}
                      onBlur={e => e.target.style.borderColor = theme.cardBorder}
                    />
                  </div>

                  {/* Email — optional, but notifications (a QD sent back to
                      them, for instance) have nowhere to go without it. */}
                  <div>
                    <label style={{
                      display: 'block', fontSize: '0.7rem', fontWeight: 700,
                      color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }} htmlFor="addusermodal-email-for-notifications">Email <span style={{ color: theme.textDim, fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>· for notifications</span></label>
                    <input id="addusermodal-email-for-notifications"
                      type="email"
                      value={newUser.email}
                      onChange={e => setNewUser({ ...newUser, email: e.target.value })}
                      placeholder="name@company.com"
                      style={{
                        width: '100%', padding: '11px 14px',
                        background: theme.inputBg, border: `1px solid ${theme.cardBorder}`,
                        borderRadius: '10px', color: theme.text, fontSize: '0.875rem',
                        outline: 'none', transition: 'border 0.2s',
                        boxSizing: 'border-box',
                      }}
                      onFocus={e => e.target.style.borderColor = theme.textDim}
                      onBlur={e => e.target.style.borderColor = theme.cardBorder}
                    />
                  </div>

                  {/* Direct line */}
                  <div>
                    <label style={{
                      display: 'block', fontSize: '0.7rem', fontWeight: 700,
                      color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }} htmlFor="addusermodal-direct-line-shown-in-their-email-sig">Direct line <span style={{ color: theme.textDim, fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>· shown in their email signature</span></label>
                    <input id="addusermodal-direct-line-shown-in-their-email-sig"
                      type="tel"
                      value={newUser.phone}
                      onChange={e => setNewUser({ ...newUser, phone: e.target.value })}
                      placeholder="+971 4 8031227"
                      style={{
                        width: '100%', padding: '11px 14px',
                        background: theme.inputBg, border: `1px solid ${theme.cardBorder}`,
                        borderRadius: '10px', color: theme.text, fontSize: '0.875rem',
                        outline: 'none', transition: 'border 0.2s',
                        boxSizing: 'border-box',
                      }}
                      onFocus={e => e.target.style.borderColor = theme.textDim}
                      onBlur={e => e.target.style.borderColor = theme.cardBorder}
                    />
                  </div>

                  {/* Password */}
                  {!isEdit && (
                    <div>
                      <label style={{
                        display: 'block', fontSize: '0.7rem', fontWeight: 700,
                        color: theme.textMuted, marginBottom: '6px', textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                      }} htmlFor="addusermodal-password">Password</label>
                      <div style={{ position: 'relative' }}>
                        <input id="addusermodal-password"
                          type={showPassword ? 'text' : 'password'}
                          value={newUser.password}
                          onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                          placeholder="Min 8 chars · upper, lower, number"
                          required
                          minLength={8}
                          style={{
                            width: '100%', padding: '11px 44px 11px 14px',
                            background: theme.inputBg, border: `1px solid ${theme.cardBorder}`,
                            borderRadius: '10px', color: theme.text, fontSize: '0.875rem',
                            outline: 'none', transition: 'border 0.2s',
                            boxSizing: 'border-box',
                          }}
                          onFocus={e => e.target.style.borderColor = theme.textDim}
                          onBlur={e => e.target.style.borderColor = theme.cardBorder}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          style={{
                            position: 'absolute', right: '10px', top: '50%',
                            transform: 'translateY(-50%)', background: 'none',
                            border: 'none', cursor: 'pointer', color: theme.textDim,
                            display: 'flex', alignItems: 'center', padding: '4px',
                          }}
                        >
                          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      <p style={{ fontSize: '0.7rem', color: theme.textDim, marginTop: '8px', marginBottom: 0, lineHeight: 1.4 }}>
                        The user will be required to change this password on first login.
                      </p>
                    </div>
                  )}
                  {isEdit && (
                    <p style={{ fontSize: '0.72rem', color: theme.textDim, margin: 0, lineHeight: 1.5 }}>
                      Use <strong style={{ color: theme.textMuted }}>Reset Password</strong> from the user table to issue a new password.
                    </p>
                  )}
                </div>

                {/* Access Summary Card */}
                <div style={{
                  background: theme.inputBg,
                  border: `1px solid ${theme.cardBorder}`,
                  borderRadius: '16px',
                  padding: '20px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '0.95rem', fontWeight: 700, color: theme.text }}>Access summary</span>
                    <span style={{
                      padding: '3px 10px', borderRadius: '12px',
                      background: 'rgba(100,116,139,0.15)', fontSize: '0.72rem',
                      fontWeight: 600, color: theme.textMuted,
                    }}>
                      {enabledCount} pages
                    </span>
                  </div>
                  <p style={{ fontSize: '0.78rem', color: theme.textDim, margin: '0 0 16px' }}>
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
                      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: theme.text }}>
                        {roleConfig.label}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: theme.textMuted, marginTop: '4px', lineHeight: 1.4 }}>
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
                      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: theme.text }}>
                        {enabledCount === CONTROLLABLE_PAGES.length ? 'Full workspace access' : 'Restricted access'}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: theme.textMuted, marginTop: '4px', lineHeight: 1.4 }}>
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
                    fontSize: '0.7rem', fontWeight: 700, color: theme.textMuted,
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
                              : `1px solid ${theme.cardBorder}`,
                            background: isSelected ? `${config.color}10` : theme.inputBg,
                            cursor: 'pointer',
                            textAlign: 'left',
                            transition: 'all 0.2s',
                            outline: 'none',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                            <Icon size={16} color={isSelected ? config.color : theme.textDim} />
                            <span style={{
                              fontSize: '0.85rem', fontWeight: 600,
                              color: isSelected ? theme.text : theme.textMuted,
                            }}>
                              {config.label}
                            </span>
                          </div>
                          <p style={{
                            fontSize: '0.7rem', color: theme.textDim,
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
                      fontSize: '0.7rem', fontWeight: 700, color: theme.textMuted,
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
                          onMouseEnter={e => { if (newUser.role !== 'admin') e.currentTarget.style.background = theme.inputBg; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                        >
                          <Checkbox
                            checked={checked}
                            onChange={() => togglePage(page.id)}
                            disabled={newUser.role === 'admin'}
                          />
                          <div>
                            <div style={{ fontSize: '0.85rem', fontWeight: 500, color: theme.text }}>
                              {page.label}
                            </div>
                            <div style={{ fontSize: '0.68rem', color: theme.textDim }}>
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
                      onMouseEnter={e => { if (newUser.role !== 'admin') e.currentTarget.style.background = theme.inputBg; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <Checkbox
                        checked={allFlowChecked}
                        onChange={toggleAllFlow}
                        color={someFlowChecked ? '#0EA5E9' : '#0EA5E9'}
                        disabled={newUser.role === 'admin'}
                      />
                      <div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: theme.text }}>
                          Process Flow
                        </div>
                        <div style={{ fontSize: '0.68rem', color: flowEnabledCount === flowPages.length ? '#34d399' : theme.textDim }}>
                          {flowEnabledCount}/{flowPages.length} stages enabled
                        </div>
                      </div>
                    </div>

                    {/* Flow sub-items */}
                    <div style={{ marginLeft: '20px', paddingLeft: '16px', borderLeft: `2px solid ${theme.cardBorder}` }}>
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
                            onMouseEnter={e => { if (newUser.role !== 'admin') e.currentTarget.style.background = theme.inputBg; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                          >
                            <Checkbox
                              checked={checked}
                              onChange={() => togglePage(page.id)}
                              color="#0EA5E9"
                              disabled={newUser.role === 'admin'}
                            />
                            <span style={{ fontSize: '0.82rem', color: checked ? theme.text : theme.textDim, fontWeight: 500 }}>
                              {page.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <p style={{
                    fontSize: '0.72rem', color: theme.textDim, margin: '12px 0 0',
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
              borderTop: `1px solid ${theme.cardBorder}`,
            }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '10px 24px', borderRadius: '10px',
                  background: 'transparent', border: `1px solid ${theme.cardBorder}`,
                  color: theme.textMuted, cursor: 'pointer', fontWeight: 500,
                  fontSize: '0.85rem', transition: 'all 0.2s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = theme.inputBg; e.currentTarget.style.color = theme.text; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = theme.textMuted; }}
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
                {isEdit ? 'Save changes' : 'Create user'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AddUserModal;
