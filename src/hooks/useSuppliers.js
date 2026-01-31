import { useState, useCallback } from 'react';
import { suppliersAPI } from '../api';

export function useSuppliers() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchSuppliers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await suppliersAPI.getAll();
      setSuppliers(response || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const createSupplier = useCallback(async (name) => {
    await suppliersAPI.create(name);
    await fetchSuppliers();
  }, [fetchSuppliers]);

  const deleteSupplier = useCallback(async (id) => {
    await suppliersAPI.delete(id);
    setSuppliers(prev => prev.filter(s => s.id !== id));
  }, []);

  return {
    suppliers,
    loading,
    error,
    fetchSuppliers,
    createSupplier,
    deleteSupplier
  };
}

export default useSuppliers;
