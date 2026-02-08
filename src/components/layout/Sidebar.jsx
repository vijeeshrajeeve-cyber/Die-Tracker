import React, { useState } from 'react';
import { Package, BarChart3, TrendingUp, Settings, Clock, Factory, ChevronDown, ChevronRight, Layers } from 'lucide-react';
import { PROCESS_FLOW_TABS, STATUS_CONFIG } from '../../utils/constants';

const Sidebar = ({ activeTab, setActiveTab, user, theme }) => {
    const [isProcessFlowExpanded, setIsProcessFlowExpanded] = useState(
        activeTab.startsWith('flow-')
    );

    const mainTabs = [
        { id: 'dashboard', label: 'Dashboard', icon: TrendingUp },
        { id: 'orders', label: 'Orders', icon: Package },
        { id: 'analytics', label: 'Analytics', icon: BarChart3 },
        ...(user?.role === 'admin' ? [
            { id: 'settings', label: 'Settings', icon: Settings },
            { id: 'users', label: 'Users', icon: Clock }
        ] : [])
    ];

    const isFlowTabActive = activeTab.startsWith('flow-');

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

                {/* Dashboard and Orders */}
                {mainTabs.slice(0, 2).map(tab => {
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
                    );
                })}

                {/* Process Flow Section */}
                <div style={{ marginTop: '4px' }}>
                    <button
                        onClick={() => setIsProcessFlowExpanded(!isProcessFlowExpanded)}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '12px',
                            padding: '12px 16px', borderRadius: '12px',
                            fontWeight: 500, fontSize: '0.95rem',
                            color: isFlowTabActive ? 'white' : theme.textMuted,
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
                            {PROCESS_FLOW_TABS.map(tab => {
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

                {/* Analytics and Admin tabs */}
                {mainTabs.slice(2).map(tab => {
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
                    );
                })}
            </div>

            {/* Bottom actions or info could go here */}
        </div>
    );
};

export default Sidebar;
