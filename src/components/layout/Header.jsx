import React, { useState } from 'react';
import { Sun, Moon, User, LogOut, Bell, ChevronDown, Key, BarChart3, Package, Layers, Settings } from 'lucide-react';

function Header({
  user,
  activeTab,
  setActiveTab,
  isDarkMode,
  toggleTheme,
  onLogout,
  onChangePassword,
  notifications = [],
  theme
}) {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
    { id: 'orders', label: 'Orders', icon: Package },
    { id: 'pipeline', label: 'Pipeline', icon: Layers },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    ...(user?.role === 'admin' ? [
      { id: 'settings', label: 'Settings', icon: Settings },
      { id: 'users', label: 'Users', icon: User }
    ] : [])
  ];

  return (
    <header style={{
      background: theme.cardBg,
      borderBottom: `1px solid ${theme.border}`,
      padding: '0 1.5rem',
      position: 'sticky',
      top: 0,
      zIndex: 100
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '64px'
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: '10px',
            background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <Package size={20} color="white" />
          </div>
          <span style={{ fontSize: '1.1rem', fontWeight: 700, color: theme.text }}>
            Die Ordering
          </span>
        </div>

        {/* Tabs */}
        <nav style={{ display: 'flex', gap: '4px' }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '10px 16px', borderRadius: '8px',
                background: activeTab === tab.id ? theme.accent : 'transparent',
                color: activeTab === tab.id ? 'white' : theme.textDim,
                border: 'none', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 500
              }}
            >
              <tab.icon size={18} />
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Right side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            style={{
              padding: '8px', borderRadius: '8px',
              background: 'transparent', border: `1px solid ${theme.border}`,
              color: theme.textDim, cursor: 'pointer'
            }}
          >
            {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {/* Notifications */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              style={{
                padding: '8px', borderRadius: '8px',
                background: 'transparent', border: `1px solid ${theme.border}`,
                color: theme.textDim, cursor: 'pointer', position: 'relative'
              }}
            >
              <Bell size={18} />
              {notifications.length > 0 && (
                <span style={{
                  position: 'absolute', top: '-4px', right: '-4px',
                  width: '18px', height: '18px', borderRadius: '50%',
                  background: '#EF4444', color: 'white', fontSize: '10px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700
                }}>
                  {notifications.length}
                </span>
              )}
            </button>
            {showNotifications && notifications.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: '8px',
                background: theme.cardBg, border: `1px solid ${theme.border}`,
                borderRadius: '12px', padding: '8px', minWidth: '280px',
                boxShadow: '0 10px 40px rgba(0,0,0,0.3)', zIndex: 1000
              }}>
                {notifications.slice(0, 5).map((n, i) => (
                  <div key={i} style={{
                    padding: '10px', borderRadius: '8px', marginBottom: '4px',
                    background: n.type === 'urgent' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)'
                  }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: n.type === 'urgent' ? '#EF4444' : '#F59E0B' }}>
                      {n.title}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: theme.textDim, marginTop: '4px' }}>
                      {n.message}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* User menu */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '8px 12px', borderRadius: '10px',
                background: theme.cardBg, border: `1px solid ${theme.border}`,
                color: theme.text, cursor: 'pointer'
              }}
            >
              <User size={18} />
              <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>{user?.username}</span>
              <ChevronDown size={14} style={{ transform: showUserMenu ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </button>
            {showUserMenu && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: '8px',
                background: theme.cardBg, border: `1px solid ${theme.border}`,
                borderRadius: '12px', padding: '8px', minWidth: '180px',
                boxShadow: '0 10px 40px rgba(0,0,0,0.3)', zIndex: 1000
              }}>
                <div style={{ padding: '10px 12px', borderBottom: `1px solid ${theme.border}`, marginBottom: '8px' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: theme.text }}>{user?.username}</div>
                  <div style={{ fontSize: '0.75rem', color: theme.textDim, textTransform: 'capitalize' }}>{user?.role}</div>
                </div>
                <button
                  onClick={() => { setShowUserMenu(false); onChangePassword(); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
                    padding: '10px 12px', borderRadius: '8px', border: 'none',
                    background: 'transparent', color: theme.text, cursor: 'pointer',
                    fontSize: '0.85rem', fontWeight: 500, textAlign: 'left'
                  }}
                >
                  <Key size={16} /> Change Password
                </button>
                <button
                  onClick={() => { setShowUserMenu(false); onLogout(); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
                    padding: '10px 12px', borderRadius: '8px', border: 'none',
                    background: 'transparent', color: '#EF4444', cursor: 'pointer',
                    fontSize: '0.85rem', fontWeight: 500, textAlign: 'left'
                  }}
                >
                  <LogOut size={16} /> Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

export default Header;
