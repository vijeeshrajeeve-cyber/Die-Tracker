import React from 'react';

export default function QDDetailPanel({ onClose }) {
  return <div onClick={onClose} style={{ position: 'fixed', inset: 0 }} />;
}
