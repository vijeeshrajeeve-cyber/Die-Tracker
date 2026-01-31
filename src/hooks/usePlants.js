import { useState, useCallback } from 'react';
import { plantsAPI } from '../api';

export function usePlants() {
  const [plants, setPlants] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchPlants = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await plantsAPI.getAll();
      setPlants(response || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const createPlant = useCallback(async (name) => {
    await plantsAPI.create(name);
    await fetchPlants();
  }, [fetchPlants]);

  const deletePlant = useCallback(async (id) => {
    await plantsAPI.delete(id);
    setPlants(prev => prev.filter(p => p.id !== id));
  }, []);

  return {
    plants,
    loading,
    error,
    fetchPlants,
    createPlant,
    deletePlant
  };
}

export default usePlants;
