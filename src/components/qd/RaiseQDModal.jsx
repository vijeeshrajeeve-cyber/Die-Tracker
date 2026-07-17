import React from 'react';

export default function RaiseQDModal({ onClose }) {
  return <div onClick={onClose} style={{ position: 'fixed', inset: 0 }} />;
}
