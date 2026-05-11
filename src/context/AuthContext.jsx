import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { authAPI, getUser, logout as apiLogout, isLoggedIn as checkLoggedIn } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [isLoggedIn, setIsLoggedIn] = useState(checkLoggedIn());
  const [user, setUser] = useState(getUser());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPasswordChangeModal, setShowPasswordChangeModal] = useState(false);
  const [forcePasswordChange, setForcePasswordChange] = useState(false);

  // Check auth status on mount
  useEffect(() => {
    const currentUser = getUser();
    if (currentUser?.passwordMustChange) {
      setForcePasswordChange(true);
      setShowPasswordChangeModal(true);
    }
  }, []);

  const login = useCallback(async (username, password) => {
    setError('');
    setLoading(true);
    try {
      const response = await authAPI.login(username, password);
      setUser(response.user);
      setIsLoggedIn(true);

      // Check if password change is required
      if (response.user?.passwordMustChange) {
        setForcePasswordChange(true);
        setShowPasswordChangeModal(true);
      }

      return response;
    } catch (err) {
      setError(err.message || 'Login failed');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    apiLogout();
    setIsLoggedIn(false);
    setUser(null);
    setForcePasswordChange(false);
    setShowPasswordChangeModal(false);
  }, []);

  const handlePasswordChangeSuccess = useCallback(() => {
    setShowPasswordChangeModal(false);
    setForcePasswordChange(false);
    const updatedUser = getUser();
    if (updatedUser) {
      setUser(updatedUser);
    }
  }, []);

  const value = {
    isLoggedIn,
    user,
    loading,
    error,
    login,
    logout,
    showPasswordChangeModal,
    setShowPasswordChangeModal,
    forcePasswordChange,
    handlePasswordChangeSuccess,
    isAdmin: user?.role === 'admin'
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;
