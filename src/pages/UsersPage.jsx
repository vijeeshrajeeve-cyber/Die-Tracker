import React from 'react';
import { CONTROLLABLE_PAGES } from '../utils/constants';
import { usersAPI } from '../api';
import { dialogs } from '../components/ui/DialogProvider';
import AddUserModal from '../components/modals/AddUserModal';
import ResetPasswordModal from '../components/modals/ResetPasswordModal';

export default function UsersPage({
  theme, user,
  users, fetchUsers,
  showAddUser, setShowAddUser,
  editingUser, setEditingUser,
  resettingUser, setResettingUser,
  handleDeleteUser,
}) {
  const tableContainer = { background: theme.cardBg, borderRadius: '8px', border: `1px solid ${theme.cardBorder}`, overflow: 'hidden', boxShadow: theme.shadowSm };
  const tableStyle = { width: '100%' };
  const scrollVars = {
    '--dt-border': theme.cardBorder,
    '--dt-header-bg': theme.tableHeaderBg,
    '--dt-header-text': theme.tableHeaderText,
    '--dt-header-border': theme.tableHeaderBorder,
    '--dt-stripe': theme.stripeBg,
    '--dt-hover': theme.rowHover,
    '--dt-body-text': theme.text,
  };
  const th = {};
  const td = {};
  const actionBtn = { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', borderRadius: '8px', fontWeight: 500, fontSize: '0.875rem', border: 'none', cursor: 'pointer', background: theme.primary, color: theme.primaryText };
  return (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: theme.text }}>User Management</h2>
                <button onClick={() => setShowAddUser(true)} style={actionBtn}>Add New User</button>
              </div>
              <div style={tableContainer}>
                <div className="dt-scroll" style={scrollVars}>
                <table className="dt-table" style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={th} className="dt-num">ID</th>
                      <th style={th}>Username</th>
                      <th style={th}>Email</th>
                      <th style={th}>Role</th>
                      <th style={th}>Page Access</th>
                      <th style={th}>Created At</th>
                      <th style={th}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id}>
                        <td style={td} className="dt-num">{u.id}</td>
                        <td style={{ ...td, fontWeight: 600, color: theme.text }}>{u.username}</td>
                        {/* No address means QD notifications cannot reach them. */}
                        <td style={td}>{u.email || <span style={{ color: theme.textDim, fontStyle: 'italic' }}>not set</span>}</td>
                        <td style={td}><span style={{ padding: '4px 10px', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 600, background: u.role === 'admin' ? '#3B82F620' : '#64748B20', color: u.role === 'admin' ? '#3B82F6' : '#94A3B8' }}>{u.role}</span></td>
                        <td style={td}>
                          {u.role === 'admin' ? (
                            <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 600, background: '#10B98120', color: '#10B981' }}>All Pages</span>
                          ) : !u.page_access ? (
                            <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 600, background: '#10B98120', color: '#10B981' }}>All Pages</span>
                          ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                              {u.page_access.map(pageId => {
                                const page = CONTROLLABLE_PAGES.find(p => p.id === pageId);
                                return page ? (
                                  <span key={pageId} style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 500, background: '#3B82F620', color: '#60A5FA' }}>{page.label}</span>
                                ) : null;
                              })}
                            </div>
                          )}
                        </td>
                        <td style={td}>{u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}</td>
                        <td style={td}>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            <button
                              onClick={() => setEditingUser(u)}
                              style={{ padding: '6px 12px', background: '#3B82F6', color: 'white', border: 'none', borderRadius: '6px', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600 }}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => setResettingUser(u)}
                              style={{ padding: '6px 12px', background: '#F59E0B', color: 'white', border: 'none', borderRadius: '6px', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600 }}
                            >
                              Reset Password
                            </button>
                            {u.id !== user.id && (
                              <button
                                onClick={() => handleDeleteUser(u.id)}
                                style={{ padding: '6px 12px', background: '#EF4444', color: 'white', border: 'none', borderRadius: '6px', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600 }}
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>

              {/* Add User Modal */}
              {showAddUser && (
                <AddUserModal
                  onClose={() => setShowAddUser(false)}
                  onSubmit={async (userData) => {
                    try {
                      await usersAPI.create(userData.username, userData.password, userData.role, userData.pageAccess, userData.email, userData.fullName, userData.phone);
                      setShowAddUser(false);
                      fetchUsers();
                    } catch (error) {
                      dialogs.notify(error.message, 'error');
                    }
                  }}
                  theme={theme}
                />
              )}

              {/* Edit User Modal */}
              {editingUser && (
                <AddUserModal
                  mode="edit"
                  initialUser={editingUser}
                  onClose={() => setEditingUser(null)}
                  onSubmit={async (userData) => {
                    try {
                      await usersAPI.update(editingUser.id, {
                        username: userData.username,
                        role: userData.role,
                        email: userData.email ?? '',
                        fullName: userData.fullName ?? '',
                        phone: userData.phone ?? '',
                        pageAccess: userData.role === 'admin' ? null : userData.pageAccess,
                      });
                      setEditingUser(null);
                      fetchUsers();
                    } catch (error) {
                      dialogs.notify(error.message, 'error');
                    }
                  }}
                  theme={theme}
                />
              )}

              {/* Reset Password Modal */}
              {resettingUser && (
                <ResetPasswordModal
                  user={resettingUser}
                  onClose={() => setResettingUser(null)}
                  onSubmit={async (password) => {
                    await usersAPI.resetPassword(resettingUser.id, password);
                    setResettingUser(null);
                    fetchUsers();
                  }}
                />
              )}
            </div>
  );
}