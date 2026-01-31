import { useState, useCallback } from 'react';
import { usersAPI } from '../api';

export function useUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await usersAPI.getAll();
      setUsers(response.users || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const createUser = useCallback(async (username, password, role) => {
    await usersAPI.create(username, password, role);
    await fetchUsers();
  }, [fetchUsers]);

  const deleteUser = useCallback(async (id) => {
    await usersAPI.delete(id);
    setUsers(prev => prev.filter(u => u.id !== id));
  }, []);

  return {
    users,
    loading,
    error,
    fetchUsers,
    createUser,
    deleteUser
  };
}

export default useUsers;
