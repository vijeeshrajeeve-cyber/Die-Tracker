import React from 'react';
import { Package, Layers, BarChart3, TrendingUp, Settings, Clock, Factory } from 'lucide-react';

const Sidebar = ({ activeTab, setActiveTab, user, theme }) => {
    const tabs = [
        { id: 'dashboard', label: 'Dashboard', icon: TrendingUp },
        { id: 'orders', label: 'Orders', icon: Package },
        { id: 'pipeline', label: 'Pipeline', icon: Layers },
        { id: 'analytics', label: 'Analytics', icon: BarChart3 },
        ...(user?.role === 'admin' ? [
            { id: 'settings', label: 'Settings', icon: Settings },
            { id: 'users', label: 'Users', icon: Clock }
        ] : [])
    ];

    return (
        <div style={{
            width: '260px',
            background: theme.sidebarBg,
            borderRight: `1px solid ${theme.cardBorder}`,
            padding: '1.5rem 1rem',
            display: 'flex',
            flexDirection: 'column',
            position: 'fixed',
            left: 0,
            top: 0,
            height: '100vh',
            zIndex: 100
        }}>
            {/* Logo */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '2.5rem', paddingLeft: '8px' }}>
                <div style={{
                    width: '40px', height: '40px',
                    background: 'linear-gradient(135deg, #3B82F6, #6366F1)',
                    borderRadius: '12px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)'
                }}>
                    <Factory size={22} color="white" />
                </div>
                <div>
                    <h1 style={{ fontSize: '1.2rem', fontWeight: 700, color: theme.text, lineHeight: 1.2 }}>Die Ordering</h1>
                    <p style={{ fontSize: '0.75rem', color: theme.textDim }}>System v2.0</p>
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <p style={{ fontSize: '0.75rem', fontWeight: 700, color: theme.textDim, padding: '0 12px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Main Menu</p>
                {tabs.map(tab => {
                    const active = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '12px',
                                padding: '12px 16px', borderRadius: '12px',
                                fontWeight: 500, fontSize: '0.95rem',
                                color: active ? 'white' : theme.textMuted,
                                background: active ? theme.primary : 'transparent',
                                border: 'none', cursor: 'pointer', textAlign: 'left',
                                width: '100%', transition: 'all 0.2s',
                                boxShadow: active ? '0 4px 12px rgba(59, 130, 246, 0.3)' : 'none'
                            }}
                        >
                            <tab.icon size={20} />
                            {tab.label}
                        </button>
                    )
                })}
            </div>

            {/* Bottom actions or info could go here */}
        </div>
    );
};

export default Sidebar;
