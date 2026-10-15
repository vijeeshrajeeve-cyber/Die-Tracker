import React from 'react';
import useProfileImage from '../../hooks/useProfileImage';

// The profile cut from a die drawing, drawn black on white like the sheet it
// came from, so it reads the same in light and dark themes. Pass `src` for an
// image not saved yet (the import preview), or orderId + fileId for a stored one.
export default function ProfileThumb({ src, orderId, fileId, size = 40, alt = 'Profile', theme = {}, style }) {
  const stored = useProfileImage(src ? null : orderId, src ? null : fileId);
  const url = src || stored;
  return (
    <span style={{
      width: size, height: size, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: '#fff', borderRadius: 6, border: `1px solid ${theme.cardBorder || '#E2E8F0'}`, overflow: 'hidden', ...style,
    }}>
      {url && <img src={url} alt={alt} style={{ maxWidth: '92%', maxHeight: '92%', objectFit: 'contain' }} />}
    </span>
  );
}
