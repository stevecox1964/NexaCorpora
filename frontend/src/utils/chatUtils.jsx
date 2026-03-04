import React from 'react';

export function parseTimestampToSeconds(timestamp) {
  const parts = timestamp.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return parts[0] * 60 + parts[1];
}

export function renderChatContent(text, onTimestampClick) {
  // Match [M:SS](videoId) or [H:MM:SS](videoId) patterns
  const timestampLinkRegex = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]\(([a-zA-Z0-9_-]+)\)/g;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = timestampLinkRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <span key={`text-${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>
      );
    }

    const timestamp = match[1];
    const videoId = match[2];
    const seconds = parseTimestampToSeconds(timestamp);

    parts.push(
      <a
        key={`ts-${match.index}`}
        className="chat-timestamp"
        href="#"
        onClick={(e) => {
          e.preventDefault();
          onTimestampClick(seconds, timestamp, videoId);
        }}
        title={`Jump to ${timestamp} in video`}
      >
        [{timestamp}]
      </a>
    );

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(<span key={`text-${lastIndex}`}>{text.slice(lastIndex)}</span>);
  }

  return parts.length > 0 ? parts : text;
}
