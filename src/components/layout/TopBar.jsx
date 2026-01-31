import React from 'react';
import { Search, Bell, Sun, Moon, FileText, Upload, Download, User, ChevronDown, LogOut, Key, ClipboardList } from 'lucide-react';

const TopBar = ({
    user,
    searchTerm,
    setSearchTerm,
    theme,
    isDarkMode,
    setIsDarkMode,
    setShowPDFImportModal,
    setShowPIImportModal,
    setShowImportModal,
    exportData,
    data, // For notifications
    showNotifications,
    setShowNotifications,
    notificationDropdown, // Prop to pass the rendered dropdown
    onLogout,
    onChangePassword
}) => {

    // Notification logic replicated/moved here for counter
    const now = new Date();
    const designOverdueOrders = data.filter(o => {
        if (o.STATUS !== 'AWAITING FOR DESIGN') return false;
        const requestedDate = new Date(o['Die Requested Date']);
        if (isNaN(requestedDate)) return false;
        const hoursDiff = (now - requestedDate) / (1000 * 60 * 60);
        return hoursDiff > 48;
    });

    const pendingOrderingOrders = data.filter(o => {
        if (o.STATUS !== 'PENDING FOR ORDERING') return false;
        const oracleDate = new Date(o['Oracle Entry']);
        if (isNaN(oracleDate)) return false;
        const hoursDiff = (now - oracleDate) / (1000 * 60 * 60);
        return hoursDiff > 24;
    });

    const totalNotifications = designOverdueOrders.length + pendingOrderingOrders.length;

    // Minimal re-implementation of email generation for the dropdown if needed
    // But maybe we just show the count and list for now to keep it valid.

    const [showUserMenu, setShowUserMenu] = React.useState(false);
    const [showPDFMenu, setShowPDFMenu] = React.useState(false);

    return (
        <div style={{
            background: theme.headerBg,
            borderBottom: `1px solid ${theme.cardBorder}`,
            padding: '1rem 2rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            position: 'sticky',
            top: 0,
            zIndex: 50,
            height: '80px'
        }}>
            {/* Left side: Search and Greeting */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '2rem', flex: 1 }}>
                <div>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: theme.text, marginBottom: '2px' }}>
                        Hey, {user?.username || 'User'}
                    </h2>
                    <p style={{ fontSize: '0.85rem', color: theme.textMuted }}>
                        {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                    </p>
                </div>

                {/* Search Bar - Moved from filter area to TopBar */}
                <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
                    <Search size={18} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: theme.textDim }} />
                    <input
                        type="text"
                        placeholder="Start searching here..."
                        value={searchTerm || ''}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        style={{
                            width: '100%',
                            padding: '12px 16px 12px 48px',
                            background: theme.inputBg,
                            border: 'none', // Cleaner look for topbar
                            borderRadius: '50px', // Rounder like reference
                            color: theme.text,
                            fontSize: '0.9rem',
                            outline: 'none',
                            boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)'
                        }}
                    />
                </div>
            </div>

            {/* Right side interactions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {/* PDF Import Dropdown */}
                <div style={{ position: 'relative' }}>
                    <button
                        onClick={() => setShowPDFMenu(!showPDFMenu)}
                        title="Import PDF"
                        style={{
                            padding: '10px',
                            borderRadius: '50%',
                            background: showPDFMenu ? theme.accent || '#3B82F6' : theme.cardBg,
                            border: `1px solid ${showPDFMenu ? (theme.accent || '#3B82F6') : theme.cardBorder}`,
                            color: showPDFMenu ? 'white' : theme.text,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                    >
                        <FileText size={20} />
                    </button>
                    {showPDFMenu && (
                        <div style={{
                            position: 'absolute',
                            top: '100%',
                            right: 0,
                            marginTop: '8px',
                            background: theme.cardBg,
                            border: `1px solid ${theme.cardBorder}`,
                            borderRadius: '12px',
                            padding: '8px',
                            minWidth: '200px',
                            boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
                            zIndex: 1000
                        }}>
                            <button
                                onClick={() => { setShowPDFImportModal(true); setShowPDFMenu(false); }}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    width: '100%',
                                    padding: '10px 12px',
                                    borderRadius: '8px',
                                    border: 'none',
                                    background: 'transparent',
                                    color: theme.text,
                                    cursor: 'pointer',
                                    fontSize: '0.9rem',
                                    fontWeight: 500,
                                    textAlign: 'left'
                                }}
                            >
                                <FileText size={16} /> Die Order Form
                            </button>
                            <button
                                onClick={() => { setShowPIImportModal(true); setShowPDFMenu(false); }}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    width: '100%',
                                    padding: '10px 12px',
                                    borderRadius: '8px',
                                    border: 'none',
                                    background: 'transparent',
                                    color: theme.text,
                                    cursor: 'pointer',
                                    fontSize: '0.9rem',
                                    fontWeight: 500,
                                    textAlign: 'left'
                                }}
                            >
                                <ClipboardList size={16} /> PI Document
                            </button>
                        </div>
                    )}
                </div>
                <button onClick={() => setShowImportModal(true)} title="Import Excel/CSV" style={{ padding: '10px', borderRadius: '50%', background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, color: theme.text, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Upload size={20} />
                </button>
                <button onClick={exportData} title="Export Data" style={{ padding: '10px', borderRadius: '50%', background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, color: theme.text, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Download size={20} />
                </button>

                <div style={{ height: '24px', width: '1px', background: theme.cardBorder, margin: '0 4px' }} />

                <button onClick={() => setIsDarkMode(!isDarkMode)} style={{ padding: '10px', borderRadius: '50%', background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, color: theme.text, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
                </button>

                {/* Notifications */}
                <div style={{ position: 'relative' }}>
                    <button
                        onClick={() => setShowNotifications(!showNotifications)}
                        style={{ padding: '10px', borderRadius: '50%', background: theme.cardBg, border: `1px solid ${theme.cardBorder}`, color: theme.text, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}
                    >
                        <Bell size={20} />
                        {totalNotifications > 0 && (
                            <span style={{ position: 'absolute', top: '-2px', right: '-2px', background: '#EF4444', color: 'white', width: '18px', height: '18px', borderRadius: '50%', fontSize: '11px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${theme.headerBg}` }}>
                                {totalNotifications}
                            </span>
                        )}
                    </button>
                    {showNotifications && notificationDropdown}
                </div>

                {/* User Profile */}
                <div style={{ position: 'relative', marginLeft: '8px' }}>
                    <button onClick={() => setShowUserMenu(!showUserMenu)} style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                        <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'linear-gradient(135deg, #3B82F6, #8B5CF6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 600 }}>
                            {user?.username?.[0]?.toUpperCase() || 'U'}
                        </div>
                        <div style={{ textAlign: 'left', display: 'none', '@media (min-width: 1200px)': { display: 'block' } }}>
                            {/* Hidden on small screens if needed, but flex handling should be fine */}
                            <p style={{ fontSize: '0.9rem', fontWeight: 600, color: theme.text, margin: 0 }}>{user?.username || 'Admin'}</p>
                            <p style={{ fontSize: '0.75rem', color: theme.textMuted, margin: 0, textTransform: 'capitalize' }}>{user?.role || 'User'}</p>
                        </div>
                        <ChevronDown size={16} color={theme.textMuted} />
                    </button>

                    {showUserMenu && (
                        <div style={{
                            position: 'absolute', top: '100%', right: 0, marginTop: '12px',
                            background: theme.cardBg, border: `1px solid ${theme.cardBorder}`,
                            borderRadius: '16px', padding: '8px', minWidth: '200px',
                            boxShadow: '0 10px 40px rgba(0,0,0,0.2)', zIndex: 1000
                        }}>
                            <button onClick={onChangePassword} style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '10px 12px', borderRadius: '8px', border: 'none', background: 'transparent', color: theme.text, cursor: 'pointer', fontSize: '0.9rem', fontWeight: 500 }}>
                                <Key size={16} /> Change Password
                            </button>
                            <button onClick={onLogout} style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '10px 12px', borderRadius: '8px', border: 'none', background: 'transparent', color: '#EF4444', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 500 }}>
                                <LogOut size={16} /> Logout
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TopBar;
