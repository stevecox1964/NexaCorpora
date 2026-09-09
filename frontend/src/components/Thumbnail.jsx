import React, { useState } from 'react';

// Thumbnail for a bookmark. YouTube videos use img.youtube.com; web pages use the
// scraped og:image, falling back to a globe placeholder when there is none.
function Thumbnail({ video, alt = '', className = '' }) {
  const [failed, setFailed] = useState(false);
  const isWeb = video?.type === 'web';
  const src = isWeb
    ? video.thumbnailUrl
    : `https://img.youtube.com/vi/${video?.videoId}/mqdefault.jpg`;

  if (!src || failed) {
    return (
      <div className={`thumb-placeholder ${className}`} title={alt}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}

export default Thumbnail;
