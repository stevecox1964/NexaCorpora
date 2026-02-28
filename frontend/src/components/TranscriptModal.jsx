import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiService } from '../services/api';

function parseTimestampToSeconds(timestamp) {
  const parts = timestamp.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return parts[0] * 60 + parts[1];
}

function renderTranscriptContent(content, videoId, onTimestampClick) {
  const timestampRegex = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = timestampRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <span key={`text-${lastIndex}`}>{content.slice(lastIndex, match.index)}</span>
      );
    }

    const timestamp = match[1];
    const seconds = parseTimestampToSeconds(timestamp);

    parts.push(
      <a
        key={`ts-${match.index}`}
        className="transcript-timestamp"
        href="#"
        onClick={(e) => {
          e.preventDefault();
          onTimestampClick(seconds, timestamp);
        }}
        title={`Jump to ${timestamp} in video`}
      >
        [{timestamp}]
      </a>
    );

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push(<span key={`text-${lastIndex}`}>{content.slice(lastIndex)}</span>);
  }

  if (parts.length === 0) {
    return content;
  }

  return parts;
}

function TranscriptModal({ videoId, videoTitle, onClose }) {
  const [transcript, setTranscript] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [playerVisible, setPlayerVisible] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const playerRef = useRef(null);
  const playerContainerRef = useRef(null);
  const apiLoadedRef = useRef(false);

  useEffect(() => {
    const fetchTranscript = async () => {
      try {
        const data = await apiService.getTranscript(videoId);
        setTranscript(data.transcript);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchTranscript();
  }, [videoId]);

  useEffect(() => {
    // Load YouTube IFrame API script if not already loaded
    if (window.YT && window.YT.Player) {
      apiLoadedRef.current = true;
      return;
    }

    if (!document.getElementById('yt-iframe-api')) {
      const tag = document.createElement('script');
      tag.id = 'yt-iframe-api';
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }

    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      apiLoadedRef.current = true;
      if (prev) prev();
    };

    return () => {
      if (window.onYouTubeIframeAPIReady === arguments[0]) {
        window.onYouTubeIframeAPIReady = prev || null;
      }
    };
  }, []);

  // Clean up player on unmount
  useEffect(() => {
    return () => {
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch (e) { /* ignore */ }
        playerRef.current = null;
      }
    };
  }, []);

  const createOrSeekPlayer = useCallback((seconds) => {
    if (playerRef.current) {
      playerRef.current.seekTo(seconds, true);
      playerRef.current.playVideo();
      return;
    }

    if (!apiLoadedRef.current && !(window.YT && window.YT.Player)) {
      // API not loaded yet, fall back to iframe src swap
      setPlayerVisible(true);
      setCurrentTime(seconds);
      return;
    }

    apiLoadedRef.current = true;
    setPlayerVisible(true);

    // Small delay to ensure the container div is rendered
    setTimeout(() => {
      const container = document.getElementById('yt-player-transcript');
      if (!container) return;

      playerRef.current = new window.YT.Player('yt-player-transcript', {
        videoId: videoId,
        playerVars: {
          autoplay: 1,
          start: seconds,
          modestbranding: 1,
          rel: 0,
        },
        events: {
          onReady: (event) => {
            event.target.seekTo(seconds, true);
            event.target.playVideo();
          },
        },
      });
    }, 50);
  }, [videoId]);

  const handleTimestampClick = useCallback((seconds, timestamp) => {
    setCurrentTime(seconds);
    createOrSeekPlayer(seconds);
  }, [createOrSeekPlayer]);

  const handleCopy = async () => {
    if (transcript?.content) {
      await navigator.clipboard.writeText(transcript.content);
    }
  };

  const hasTimestamps = transcript?.content && /\[\d{1,2}:\d{2}(?::\d{2})?\]/.test(transcript.content);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal transcript-modal" onClick={(e) => e.stopPropagation()}>
        <div className="transcript-modal-header">
          <h2>Transcript</h2>
          <button className="btn btn-sm btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="transcript-modal-title">{videoTitle}</p>

        {loading ? (
          <div className="transcript-modal-loading">Loading transcript...</div>
        ) : error ? (
          <div className="transcript-modal-error">{error}</div>
        ) : (
          <>
            {playerVisible && (
              <div className="transcript-player-wrapper">
                <div id="yt-player-transcript" ref={playerContainerRef}></div>
              </div>
            )}
            <div className="transcript-modal-actions">
              <button className="btn btn-sm btn-secondary" onClick={handleCopy}>
                Copy to Clipboard
              </button>
              {hasTimestamps && !playerVisible && (
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => createOrSeekPlayer(0)}
                >
                  Open Player
                </button>
              )}
            </div>
            <div className="transcript-modal-content">
              {renderTranscriptContent(transcript.content, videoId, handleTimestampClick)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default TranscriptModal;
