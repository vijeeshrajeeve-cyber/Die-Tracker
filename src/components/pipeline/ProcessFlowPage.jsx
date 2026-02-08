import React, { useMemo, useState } from 'react';
import { Search, Eye, Plane, Truck, ChevronUp, ChevronDown, Package } from 'lucide-react';
import { STATUS_CONFIG } from '../../utils/constants';

function ProcessFlowPage({
    status,
    data,
    onOrderClick,
    theme,
    searchTerm = '',
    setSearchTerm
}) {
    const config = STATUS_CONFIG[status] || { color: '#6B7280', label: status, bgColor: '#F3F4F6' };
    const [sortConfig, setSortConfig] = useState({ key: 'DIE NO', direction: 'asc' });
    const [localSearch, setLocalSearch] = useState('');

    // Use local search if setSearchTerm is not provided
    const effectiveSearchTerm = setSearchTerm ? searchTerm : localSearch;
    const handleSearchChange = setSearchTerm || setLocalSearch;

    // Filter orders by status and search term
    const filteredOrders = useMemo(() => {
        let orders = data.filter(o => o.STATUS === status);

        if (effectiveSearchTerm) {
            const term = effectiveSearchTerm.toLowerCase();
            orders = orders.filter(o =>
                (o['DIE NO'] && o['DIE NO'].toLowerCase().includes(term)) ||
                (o['Order No'] && o['Order No'].toLowerCase().includes(term)) ||
                (o.Supplier && o.Supplier.toLowerCase().includes(term)) ||
                (o.Plant && o.Plant.toLowerCase().includes(term))
            );
        }

        return orders;
    }, [data, status, effectiveSearchTerm]);

    // Sort orders
    const sortedOrders = useMemo(() => {
        const sorted = [...filteredOrders];
        if (sortConfig.key) {
            sorted.sort((a, b) => {
                const aVal = a[sortConfig.key] || '';
                const bVal = b[sortConfig.key] || '';
                if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return sorted;
    }, [filteredOrders, sortConfig]);

    const handleSort = (key) => {
        setSortConfig(prev => ({
            key,
            direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
        }));
    };

    const StatusIcon = config.icon || Package;

    const styles = {
        container: {
            padding: '0'
        },
        header: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '1.5rem',
            flexWrap: 'wrap',
            gap: '1rem'
        },
        titleSection: {
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
        },
        iconContainer: {
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            background: `${config.color}20`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
        },
        title: {
            fontSize: '1.5rem',
            fontWeight: 700,
            color: theme.text,
            margin: 0
        },
        count: {
            background: config.color,
            color: 'white',
            padding: '4px 12px',
            borderRadius: '20px',
            fontSize: '0.875rem',
            fontWeight: 600
        },
        searchContainer: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: theme.inputBg,
            borderRadius: '10px',
            padding: '10px 14px',
            border: `1px solid ${theme.border}`,
            minWidth: '280px'
        },
        searchInput: {
            border: 'none',
            background: 'transparent',
            color: theme.text,
            fontSize: '0.9rem',
            outline: 'none',
            width: '100%'
        },
        tableContainer: {
            background: theme.cardBg,
            borderRadius: '16px',
            border: `1px solid ${theme.border}`,
            overflow: 'hidden'
        },
        table: {
            width: '100%',
            borderCollapse: 'collapse'
        },
        th: {
            padding: '14px 16px',
            textAlign: 'left',
            fontSize: '0.75rem',
            fontWeight: 600,
            textTransform: 'uppercase',
            color: theme.textMuted,
            background: theme.tableBg || theme.cardBg,
            borderBottom: `1px solid ${theme.border}`,
            cursor: 'pointer',
            userSelect: 'none',
            transition: 'background 0.2s'
        },
        td: {
            padding: '14px 16px',
            fontSize: '0.9rem',
            color: theme.text,
            borderBottom: `1px solid ${theme.border}`
        },
        emptyState: {
            textAlign: 'center',
            padding: '4rem 2rem',
            color: theme.textMuted
        },
        emptyIcon: {
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: `${config.color}15`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1rem'
        },
        row: {
            cursor: 'pointer',
            transition: 'background 0.15s'
        }
    };

    return (
        <div style={styles.container}>
            {/* Header */}
            <div style={styles.header}>
                <div style={styles.titleSection}>
                    <div style={styles.iconContainer}>
                        <StatusIcon size={24} color={config.color} />
                    </div>
                    <div>
                        <h1 style={styles.title}>{config.label}</h1>
                        <p style={{ fontSize: '0.85rem', color: theme.textMuted, margin: '4px 0 0' }}>
                            Orders in {config.label.toLowerCase()} stage
                        </p>
                    </div>
                    <span style={styles.count}>{filteredOrders.length}</span>
                </div>

                <div style={styles.searchContainer}>
                    <Search size={18} color={theme.textMuted} />
                    <input
                        type="text"
                        placeholder="Search orders..."
                        value={effectiveSearchTerm}
                        onChange={(e) => handleSearchChange(e.target.value)}
                        style={styles.searchInput}
                    />
                </div>
            </div>

            {/* Table */}
            <div style={styles.tableContainer}>
                {sortedOrders.length > 0 ? (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={styles.table}>
                            <thead>
                                <tr>
                                    {[
                                        { key: 'DIE NO', label: 'Die No' },
                                        { key: 'Order No', label: 'Order' },
                                        { key: 'Plant', label: 'Plant' },
                                        { key: 'TYPE', label: 'Type' },
                                        { key: 'Die Size', label: 'Size' },
                                        { key: 'Supplier', label: 'Supplier' },
                                        { key: 'Die Requested Date', label: 'Requested' },
                                        { key: 'Type of shipment', label: 'Shipment' }
                                    ].map(col => (
                                        <th
                                            key={col.key}
                                            style={styles.th}
                                            onClick={() => handleSort(col.key)}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                {col.label}
                                                {sortConfig.key === col.key ? (
                                                    sortConfig.direction === 'asc' ?
                                                        <ChevronUp size={14} color={config.color} /> :
                                                        <ChevronDown size={14} color={config.color} />
                                                ) : (
                                                    <ChevronDown size={14} color={theme.textMuted} style={{ opacity: 0.3 }} />
                                                )}
                                            </div>
                                        </th>
                                    ))}
                                    <th style={{ ...styles.th, textAlign: 'center' }}>View</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedOrders.map((order, idx) => (
                                    <tr
                                        key={`${order['DIE NO']}-${idx}`}
                                        style={styles.row}
                                        onClick={() => onOrderClick(order)}
                                        onMouseEnter={(e) => e.currentTarget.style.background = theme.hoverBg || 'rgba(255,255,255,0.03)'}
                                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                    >
                                        <td style={styles.td}>
                                            <span style={{ fontWeight: 600, color: theme.text, fontFamily: 'monospace' }}>
                                                {order['DIE NO']}
                                            </span>
                                        </td>
                                        <td style={styles.td}>{order['Order No']}</td>
                                        <td style={styles.td}>
                                            <span style={{
                                                padding: '4px 10px',
                                                borderRadius: '6px',
                                                fontSize: '0.75rem',
                                                fontWeight: 600,
                                                background: order.Plant === 'EXT 1' ? 'rgba(59,130,246,0.2)' : 'rgba(139,92,246,0.2)',
                                                color: order.Plant === 'EXT 1' ? '#60A5FA' : '#A78BFA'
                                            }}>
                                                {order.Plant}
                                            </span>
                                        </td>
                                        <td style={styles.td}>
                                            <span style={{
                                                padding: '4px 8px',
                                                borderRadius: '4px',
                                                fontSize: '0.75rem',
                                                fontWeight: 600,
                                                background: order.TYPE === 'N' ? '#3B82F620' : order.TYPE === 'B' ? '#F59E0B20' : '#64748B20',
                                                color: order.TYPE === 'N' ? '#3B82F6' : order.TYPE === 'B' ? '#F59E0B' : '#64748B'
                                            }}>
                                                {order.TYPE === 'N' ? 'New' : order.TYPE === 'B' ? 'Backup' : order.TYPE}
                                            </span>
                                        </td>
                                        <td style={styles.td}>{order['Die Size']}</td>
                                        <td style={styles.td}>{order.Supplier}</td>
                                        <td style={styles.td}>{order['Die Requested Date']}</td>
                                        <td style={styles.td}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                {order['Type of shipment'] === 'AIR' ?
                                                    <Plane size={14} color="#0EA5E9" /> :
                                                    <Truck size={14} color="#10B981" />
                                                }
                                                {order['Type of shipment']}
                                            </div>
                                        </td>
                                        <td style={{ ...styles.td, textAlign: 'center' }}>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onOrderClick(order); }}
                                                style={{
                                                    padding: '8px',
                                                    background: 'transparent',
                                                    border: 'none',
                                                    borderRadius: '8px',
                                                    cursor: 'pointer',
                                                    color: theme.textMuted,
                                                    transition: 'color 0.2s'
                                                }}
                                                onMouseEnter={(e) => e.currentTarget.style.color = config.color}
                                                onMouseLeave={(e) => e.currentTarget.style.color = theme.textMuted}
                                            >
                                                <Eye size={18} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div style={styles.emptyState}>
                        <div style={styles.emptyIcon}>
                            <StatusIcon size={28} color={config.color} />
                        </div>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: theme.text, marginBottom: '0.5rem' }}>
                            No Orders in {config.label}
                        </h3>
                        <p style={{ fontSize: '0.9rem', color: theme.textMuted }}>
                            {effectiveSearchTerm
                                ? 'No orders match your search criteria'
                                : 'There are currently no orders at this stage'}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}

export default ProcessFlowPage;
