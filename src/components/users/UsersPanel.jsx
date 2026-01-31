import React, { useState } from 'react';
import { Users, Plus, Trash2, Shield, User, Calendar, Key, Eye, EyeOff } from 'lucide-react';

function UsersPanel({ users, currentUser, onAddUser, onDeleteUser, theme }) {
  const [showAddUser, setShowAddUser] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [newUser, setNewUser] = useState({
    username: '',
    password: '',
    role: 'user'
  });

  const handleAddUser = async (e) => {
    e.preventDefault();
    if (!newUser.username.trim() || !newUser.password.trim()) {
      alert('Username and password are required');
      return;
    }
    if (newUser.password.length < 6) {
      alert('Password must be at least 6 characters');
      return;
    }
    try {
      await onAddUser(newUser);
      setNewUser({ username: '', password: '', role: 'user' });
      setShowAddUser(false);
      setShowPassword(false);
    } catch (error) {
      alert(error.message);
    }
  };

  const handleDeleteUser = async (userId, username) => {
    if (username === currentUser?.username) {
      alert('You cannot delete your own account');
      return;
    }
    if (confirm(`Delete user "${username}"? This action cannot be undone.`)) {
      try {
        await onDeleteUser(userId);
      } catch (error) {
        alert(error.message);
      }
    }
  };

  const cardStyle = {
    background: theme.cardBg,
    borderRadius: '16px',
    padding: '1.5rem',
    border: `1px solid ${theme.border}`
  };

  const inputStyle = {
    padding: '10px 14px',
    background: theme.inputBg || theme.bg,
    border: `1px solid ${theme.border}`,
    borderRadius: '8px',
    color: theme.text,
    fontSize: '0.9rem',
    width: '100%'
  };

  const buttonStyle = {
    padding: '10px 20px',
    background: '#3B82F6',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem' }}>
      {/* Users List */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: theme.text, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Users size={20} />
            Users ({users.length})
          </h3>
          <button
            onClick={() => setShowAddUser(!showAddUser)}
            style={{
              padding: '8px 16px',
              background: showAddUser ? theme.border : '#3B82F6',
              color: showAddUser ? theme.text : 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.9rem',
              fontWeight: 500
            }}
          >
            <Plus size={18} />
            Add User
          </button>
        </div>

        {/* Add User Form */}
        {showAddUser && (
          <form onSubmit={handleAddUser} style={{
            marginBottom: '1.5rem',
            padding: '1rem',
            background: theme.bg,
            borderRadius: '12px',
            border: `1px solid ${theme.border}`
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: theme.textMuted, marginBottom: '6px' }}>
                  Username
                </label>
                <input
                  type="text"
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                  placeholder="Enter username"
                  style={inputStyle}
                  autoComplete="off"
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: theme.textMuted, marginBottom: '6px' }}>
                  Password
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    placeholder="Min 6 characters"
                    style={{ ...inputStyle, paddingRight: '40px' }}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: 'absolute',
                      right: '10px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: theme.textMuted,
                      padding: '4px'
                    }}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: theme.textMuted, marginBottom: '6px' }}>
                  Role
                </label>
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                  style={inputStyle}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => {
                  setShowAddUser(false);
                  setNewUser({ username: '', password: '', role: 'user' });
                  setShowPassword(false);
                }}
                style={{
                  ...buttonStyle,
                  background: 'transparent',
                  border: `1px solid ${theme.border}`,
                  color: theme.text
                }}
              >
                Cancel
              </button>
              <button type="submit" style={buttonStyle}>
                Create User
              </button>
            </div>
          </form>
        )}

        {/* Users Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${theme.border}` }}>
                <th style={{ textAlign: 'left', padding: '12px 8px', color: theme.textMuted, fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 600 }}>
                  User
                </th>
                <th style={{ textAlign: 'left', padding: '12px 8px', color: theme.textMuted, fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 600 }}>
                  Role
                </th>
                <th style={{ textAlign: 'left', padding: '12px 8px', color: theme.textMuted, fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 600 }}>
                  Created
                </th>
                <th style={{ textAlign: 'right', padding: '12px 8px', color: theme.textMuted, fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 600 }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr
                  key={user.id}
                  style={{
                    borderBottom: `1px solid ${theme.border}`,
                    background: user.username === currentUser?.username ? `${theme.accent}10` : 'transparent'
                  }}
                >
                  <td style={{ padding: '14px 8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '50%',
                        background: user.role === 'admin' ? 'linear-gradient(135deg, #8B5CF6, #6366F1)' : 'linear-gradient(135deg, #3B82F6, #06B6D4)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        fontWeight: 600,
                        fontSize: '0.9rem'
                      }}>
                        {user.username.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p style={{ color: theme.text, fontWeight: 500, fontSize: '0.95rem' }}>
                          {user.username}
                          {user.username === currentUser?.username && (
                            <span style={{ marginLeft: '8px', fontSize: '0.75rem', color: theme.accent }}>(You)</span>
                          )}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '14px 8px' }}>
                    <span style={{
                      padding: '4px 10px',
                      borderRadius: '20px',
                      fontSize: '0.8rem',
                      fontWeight: 500,
                      background: user.role === 'admin' ? 'rgba(139, 92, 246, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                      color: user.role === 'admin' ? '#8B5CF6' : '#3B82F6',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      {user.role === 'admin' ? <Shield size={12} /> : <User size={12} />}
                      {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                    </span>
                  </td>
                  <td style={{ padding: '14px 8px' }}>
                    <span style={{ color: theme.textMuted, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Calendar size={14} />
                      {formatDate(user.created_at)}
                    </span>
                  </td>
                  <td style={{ padding: '14px 8px', textAlign: 'right' }}>
                    {user.username !== currentUser?.username && (
                      <button
                        onClick={() => handleDeleteUser(user.id, user.username)}
                        style={{
                          padding: '6px 12px',
                          background: 'transparent',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          borderRadius: '6px',
                          color: '#EF4444',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontSize: '0.85rem'
                        }}
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Info Panel */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {/* Current User Info */}
        <div style={cardStyle}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: theme.text, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <User size={18} />
            Your Account
          </h3>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '1rem',
            background: theme.bg,
            borderRadius: '12px'
          }}>
            <div style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              background: currentUser?.role === 'admin' ? 'linear-gradient(135deg, #8B5CF6, #6366F1)' : 'linear-gradient(135deg, #3B82F6, #06B6D4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontWeight: 700,
              fontSize: '1.5rem',
              marginBottom: '12px'
            }}>
              {currentUser?.username?.charAt(0).toUpperCase() || '?'}
            </div>
            <p style={{ color: theme.text, fontWeight: 600, fontSize: '1.1rem' }}>
              {currentUser?.username || 'Unknown'}
            </p>
            <span style={{
              marginTop: '8px',
              padding: '4px 12px',
              borderRadius: '20px',
              fontSize: '0.8rem',
              fontWeight: 500,
              background: currentUser?.role === 'admin' ? 'rgba(139, 92, 246, 0.15)' : 'rgba(59, 130, 246, 0.15)',
              color: currentUser?.role === 'admin' ? '#8B5CF6' : '#3B82F6'
            }}>
              {currentUser?.role === 'admin' ? 'Administrator' : 'User'}
            </span>
          </div>
        </div>

        {/* Role Permissions */}
        <div style={cardStyle}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: theme.text, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Key size={18} />
            Role Permissions
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ padding: '12px', background: 'rgba(139, 92, 246, 0.1)', borderRadius: '8px', border: '1px solid rgba(139, 92, 246, 0.2)' }}>
              <p style={{ color: '#8B5CF6', fontWeight: 600, fontSize: '0.9rem', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Shield size={14} />
                Admin
              </p>
              <ul style={{ margin: 0, paddingLeft: '20px', color: theme.textMuted, fontSize: '0.8rem', lineHeight: 1.6 }}>
                <li>Manage users</li>
                <li>Import/Export data</li>
                <li>All order operations</li>
                <li>System settings</li>
              </ul>
            </div>
            <div style={{ padding: '12px', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
              <p style={{ color: '#3B82F6', fontWeight: 600, fontSize: '0.9rem', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <User size={14} />
                User
              </p>
              <ul style={{ margin: 0, paddingLeft: '20px', color: theme.textMuted, fontSize: '0.8rem', lineHeight: 1.6 }}>
                <li>View orders</li>
                <li>Update order status</li>
                <li>View analytics</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Statistics */}
        <div style={cardStyle}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: theme.text, marginBottom: '1rem' }}>
            User Statistics
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div style={{ textAlign: 'center', padding: '12px', background: theme.bg, borderRadius: '8px' }}>
              <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#8B5CF6' }}>
                {users.filter(u => u.role === 'admin').length}
              </p>
              <p style={{ fontSize: '0.75rem', color: theme.textMuted, textTransform: 'uppercase' }}>Admins</p>
            </div>
            <div style={{ textAlign: 'center', padding: '12px', background: theme.bg, borderRadius: '8px' }}>
              <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#3B82F6' }}>
                {users.filter(u => u.role === 'user').length}
              </p>
              <p style={{ fontSize: '0.75rem', color: theme.textMuted, textTransform: 'uppercase' }}>Users</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default UsersPanel;
