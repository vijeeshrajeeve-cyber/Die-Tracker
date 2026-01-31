import { useState, useCallback, useMemo } from 'react';
import { ordersAPI } from '../api';
import { calculateStats } from '../utils/helpers';
import { MONTHS, QUARTER_MONTHS } from '../utils/constants';

export function useOrders() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await ordersAPI.getAll();
      setData(response.orders || []);
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const createOrder = useCallback(async (order) => {
    const response = await ordersAPI.create(order);
    await fetchOrders();
    return response;
  }, [fetchOrders]);

  const updateOrder = useCallback(async (id, order) => {
    await ordersAPI.update(id, order);
    setData(prev => prev.map(o => o.id === id ? { ...o, ...order } : o));
  }, []);

  const deleteOrder = useCallback(async (id) => {
    await ordersAPI.delete(id);
    setData(prev => prev.filter(o => o.id !== id));
  }, []);

  const importOrders = useCallback(async (orders) => {
    for (const order of orders) {
      await ordersAPI.create(order);
    }
    await fetchOrders();
  }, [fetchOrders]);

  const stats = useMemo(() => calculateStats(data), [data]);

  const monthlyTrendData = useMemo(() => {
    return MONTHS.map(month => {
      const monthOrders = data.filter(o => o.month === month);
      return {
        month,
        new: monthOrders.filter(o => o.TYPE === 'N').length,
        backup: monthOrders.filter(o => o.TYPE === 'B').length
      };
    });
  }, [data]);

  const getFilteredAnalyticsData = useCallback((period, quarter) => {
    let filtered = data;
    if (period !== 'all') {
      filtered = filtered.filter(o => o.month === period);
    }
    if (quarter !== 'all' && QUARTER_MONTHS[quarter]) {
      filtered = filtered.filter(o => QUARTER_MONTHS[quarter].includes(o.month));
    }
    return filtered;
  }, [data]);

  return {
    data,
    setData,
    loading,
    error,
    fetchOrders,
    createOrder,
    updateOrder,
    deleteOrder,
    importOrders,
    stats,
    monthlyTrendData,
    getFilteredAnalyticsData
  };
}

export default useOrders;
