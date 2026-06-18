import React from 'react';
import { Package, BarChart3, TrendingUp, Settings, Clock, ChevronLeft, ChevronRight, ClipboardList, Mail, Snowflake } from 'lucide-react';
import { PROCESS_FLOW_TABS, STATUS_CONFIG } from '../../utils/constants';

const Sidebar = ({ activeTab, setActiveTab, user, theme, collapsed, setCollapsed }) => {
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
        { id: 'frozen-designs', label: 'Frozen Designs', icon: Snowflake, pageId: 'frozen-designs' },
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
    const topTabs = mainTabs.filter(t => ['dashboard', 'orders', 'backup-requests', 'frozen-designs', 'email-inbox'].includes(t.id));
    const bottomTabs = mainTabs.filter(t => !['dashboard', 'orders', 'backup-requests', 'frozen-designs', 'email-inbox'].includes(t.id));

    // Filter flow tabs by individual access
    const accessibleFlowTabs = PROCESS_FLOW_TABS.filter(tab => hasAccess(tab.id));
    const showProcessFlow = accessibleFlowTabs.length > 0;
    const sidebarWidth = collapsed ? '64px' : '260px';
    const sidebarPaddingX = collapsed ? '0.5rem' : '1rem';

    const sectionLabelStyle = {
        fontSize: '0.75rem',
        fontWeight: 700,
        color: theme.textDim,
        padding: '0 12px',
        marginBottom: '8px',
        textTransform: 'uppercase',
        letterSpacing: '0.5px'
    };

    const getNavButtonStyle = (active, variant = 'main', status = null) => {
        const statusColor = variant === 'flow' ? (STATUS_CONFIG[status]?.color || '#3B82F6') : null;

        return {
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            gap: collapsed ? 0 : '12px',
            padding: collapsed ? '12px 0' : '12px 16px',
            borderRadius: '12px',
            fontWeight: 500,
            fontSize: '0.95rem',
            color: active ? (variant === 'flow' ? theme.text : theme.primaryText) : theme.textMuted,
            background: active
                ? (variant === 'flow'
                    ? `${statusColor}20`
                    : theme.primary)
                : 'transparent',
            border: 'none',
            cursor: 'pointer',
            textAlign: collapsed ? 'center' : 'left',
            width: '100%',
            transition: 'all 0.2s',
            boxShadow: active && variant !== 'flow' ? '0 4px 12px rgba(59, 130, 246, 0.3)' : 'none',
            flexShrink: 0
        };
    };

    const renderNavButton = (tab, variant = 'main') => {
        const active = activeTab === tab.id;

        return (
            <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                title={tab.label}
                style={getNavButtonStyle(active, variant, tab.status)}
            >
                <tab.icon size={20} />
                <span style={{ display: collapsed ? 'none' : 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {tab.label}
                </span>
            </button>
        );
    };

    return (
        <div style={{
            width: sidebarWidth,
            background: theme.sidebarBg,
            borderRight: `1px solid ${theme.cardBorder}`,
            padding: `1.5rem ${sidebarPaddingX}`,
            display: 'flex',
            flexDirection: 'column',
            position: 'fixed',
            left: 0,
            top: 0,
            height: '100vh',
            zIndex: 100,
            overflowY: 'auto',
            transition: 'width 0.2s ease',
            boxSizing: 'border-box'
        }}>
            {/* Brand + company logo (public/company-logo.png) */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'flex-start',
                gap: collapsed ? 0 : '12px',
                marginBottom: '2.5rem',
                paddingLeft: collapsed ? 0 : '8px',
                minHeight: collapsed ? '40px' : 'auto'
            }}>
                <img
                    src="/company-logo.png"
                    alt="Company"
                    style={{
                        display: 'block',
                        flexShrink: 0,
                        height: collapsed ? 36 : 40,
                        width: collapsed ? 36 : 'auto',
                        maxWidth: collapsed ? 40 : 152,
                        objectFit: 'contain',
                        objectPosition: collapsed ? 'center' : 'left center'
                    }}
                />
                <div style={{
                    opacity: collapsed ? 0 : 1,
                    width: collapsed ? 0 : '148px',
                    overflow: 'hidden',
                    transition: 'opacity 0.2s ease, width 0.2s ease'
                }}>
                    <h1 style={{ fontSize: '1.2rem', fontWeight: 700, color: theme.text, lineHeight: 1.2 }}>Die Ordering</h1>
                    <p style={{ fontSize: '0.75rem', color: theme.textDim }}>System v2.0</p>
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {!collapsed && <p style={sectionLabelStyle}>Main Menu</p>}

                {/* Top tabs (Dashboard, Orders, Backup Requests) */}
                {topTabs.map(tab => renderNavButton(tab))}

                {/* Process Flow Section */}
                {showProcessFlow && !collapsed && <p style={{ ...sectionLabelStyle, marginTop: '8px' }}>Process Flow</p>}
                {showProcessFlow && accessibleFlowTabs.map(tab => renderNavButton(tab, 'flow'))}

                {/* Bottom tabs (Analytics, Settings, Users) */}
                {bottomTabs.map(tab => renderNavButton(tab))}
            </div>

            <div style={{ marginTop: 'auto', paddingTop: '1rem' }}>
                <button
                    onClick={() => setCollapsed(!collapsed)}
                    title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: collapsed ? 'center' : 'flex-start',
                        gap: collapsed ? 0 : '12px',
                        padding: collapsed ? '12px 0' : '12px 16px',
                        borderRadius: '12px',
                        fontWeight: 500,
                        fontSize: '0.95rem',
                        color: theme.textMuted,
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        textAlign: collapsed ? 'center' : 'left',
                        width: '100%',
                        transition: 'all 0.2s'
                    }}
                >
                    {collapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
                    <span style={{ display: collapsed ? 'none' : 'block', whiteSpace: 'nowrap' }}>
                        {collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    </span>
                </button>
            </div>
        </div>
    );
};

export default Sidebar;
