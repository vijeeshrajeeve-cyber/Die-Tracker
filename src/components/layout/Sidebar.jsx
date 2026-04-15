import React, { useState } from 'react';
import { Package, BarChart3, TrendingUp, Settings, Clock, Factory, ChevronDown, ChevronRight, Layers, ClipboardList, Mail } from 'lucide-react';
import { PROCESS_FLOW_TABS, STATUS_CONFIG } from '../../utils/constants';

const Sidebar = ({ activeTab, setActiveTab, user, theme }) => {
    const [isProcessFlowExpanded, setIsProcessFlowExpanded] = useState(
        activeTab.startsWith('flow-')
    );

    // Check if user has access to a page
    const hasAccess = (pageId) => {
        if (user?.role === 'admin') return true;
        if (!user?.pageAccess) return true; // null = all pages
        if (user.pageAccess.includes(pageId)) return true;
        // Backward compat: old 'process-flow' permission grants all flow pages
        if (pageId.startsWith('flow-') && user.pageAccess.includes('process-flow')) return true;
        return false;
    };

    const allTabs = [
        { id: 'dashboard', label: 'Dashboard', icon: TrendingUp, pageId: 'dashboard' },
        { id: 'orders', label: 'Orders', icon: Package, pageId: 'orders' },
        { id: 'backup-requests', label: 'Backup Die Requests', icon: ClipboardList, pageId: 'backup-requests' },
        { id: 'email-inbox', label: 'Email Inbox', icon: Mail, pageId: 'email-inbox' },
        { id: 'analytics', label: 'Analytics', icon: BarChart3, pageId: 'analytics' },
        ...(user?.role === 'admin' ? [
            { id: 'email-settings', label: 'Email Settings', icon: Settings, pageId: 'email-settings' },
            { id: 'settings', label: 'Settings', icon: Settings, pageId: 'settings' },
            { id: 'users', label: 'Users', icon: Clock, pageId: 'users' }
        ] : [])
    ];

    const mainTabs = allTabs.filter(tab => hasAccess(tab.pageId));

    // Split tabs: before and after the process-flow insertion point
    const topTabs = mainTabs.filter(t => ['dashboard', 'orders', 'backup-requests', 'email-inbox'].includes(t.id));
    const bottomTabs = mainTabs.filter(t => !['dashboard', 'orders', 'backup-requests', 'email-inbox'].includes(t.id));

    const isFlowTabActive = activeTab.startsWith('flow-');
    // Filter flow tabs by individual access
    const accessibleFlowTabs = PROCESS_FLOW_TABS.filter(tab => hasAccess(tab.id));
    const showProcessFlow = accessibleFlowTabs.length > 0;

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
            zIndex: 100,
            overflowY: 'auto'
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

                {/* Top tabs (Dashboard, Orders, Backup Requests) */}
                {topTabs.map(tab => {
                    const active = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '12px',
                                padding: '12px 16px', borderRadius: '12px',
                                fontWeight: 500, fontSize: '0.95rem',
                                color: active ? theme.primaryText : theme.textMuted,
                                background: active ? theme.primary : 'transparent',
                                border: 'none', cursor: 'pointer', textAlign: 'left',
                                width: '100%', transition: 'all 0.2s',
                                boxShadow: active ? '0 4px 12px rgba(59, 130, 246, 0.3)' : 'none'
                            }}
                        >
                            <tab.icon size={20} />
                            {tab.label}
                        </button>
                    );
                })}

                {/* Process Flow Section */}
                {showProcessFlow && (
                    <div style={{ marginTop: '4px' }}>
                        <button
                            onClick={() => setIsProcessFlowExpanded(!isProcessFlowExpanded)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '12px',
                                padding: '12px 16px', borderRadius: '12px',
                                fontWeight: 500, fontSize: '0.95rem',
                                color: isFlowTabActive ? theme.primaryText : theme.textMuted,
                                background: isFlowTabActive ? theme.primary : 'transparent',
                                border: 'none', cursor: 'pointer', textAlign: 'left',
                                width: '100%', transition: 'all 0.2s',
                                boxShadow: isFlowTabActive ? '0 4px 12px rgba(59, 130, 246, 0.3)' : 'none'
                            }}
                        >
                            <Layers size={20} />
                            <span style={{ flex: 1 }}>Process Flow</span>
                            {isProcessFlowExpanded ?
                                <ChevronDown size={16} /> :
                                <ChevronRight size={16} />
                            }
                        </button>

                        {/* Sub-items */}
                        {isProcessFlowExpanded && (
                            <div style={{
                                marginTop: '4px',
                                marginLeft: '16px',
                                paddingLeft: '16px',
                                borderLeft: `2px solid ${theme.cardBorder}`
                            }}>
                                {accessibleFlowTabs.map(tab => {
                                    const active = activeTab === tab.id;
                                    const config = STATUS_CONFIG[tab.status] || { color: '#6B7280' };
                                    return (
                                        <button
                                            key={tab.id}
                                            onClick={() => setActiveTab(tab.id)}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: '10px',
                                                padding: '10px 12px', borderRadius: '8px',
                                                fontWeight: 500, fontSize: '0.85rem',
                                                color: active ? theme.text : theme.textMuted,
                                                background: active ? `${config.color}20` : 'transparent',
                                                border: 'none', cursor: 'pointer', textAlign: 'left',
                                                width: '100%', transition: 'all 0.2s',
                                                marginBottom: '2px'
                                            }}
                                        >
                                            <div style={{
                                                width: '8px',
                                                height: '8px',
                                                borderRadius: '50%',
                                                background: active ? config.color : theme.textMuted,
                                                opacity: active ? 1 : 0.4
                                            }} />
                                            {tab.label}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* Bottom tabs (Analytics, Settings, Users) */}
                {bottomTabs.map(tab => {
                    const active = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '12px',
                                padding: '12px 16px', borderRadius: '12px',
                                fontWeight: 500, fontSize: '0.95rem',
                                color: active ? theme.primaryText : theme.textMuted,
                                background: active ? theme.primary : 'transparent',
                                border: 'none', cursor: 'pointer', textAlign: 'left',
                                width: '100%', transition: 'all 0.2s',
                                boxShadow: active ? '0 4px 12px rgba(59, 130, 246, 0.3)' : 'none'
                            }}
                        >
                            <tab.icon size={20} />
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* Bottom actions or info could go here */}
        </div>
    );
};

export default Sidebar;
