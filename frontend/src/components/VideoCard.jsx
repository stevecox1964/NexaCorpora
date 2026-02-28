import React, { useState, useRef, useEffect } from 'react';

function VideoCard({ video, onDelete, onTranscribe, onRetranscribe, onViewTranscript, onGenerateSummary, onToggleSummary, summaryState }) {
  const thumbnailUrl = `https://img.youtube.com/vi/${video.videoId}/mqdefault.jpg`;
  const [showSummaryMenu, setShowSummaryMenu] = useState(false);
  const menuRef = useRef(null);

  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown date';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Close menu on outside click
  useEffect(() => {
    if (!showSummaryMenu) return;
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowSummaryMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showSummaryMenu]);

  const hasTranscript = video.hasTranscript || false;
  const hasSummary = video.hasSummary || false;
  const transcriptJobStatus = video.transcriptJobStatus || null;

  const handleSummarize = (type) => {
    setShowSummaryMenu(false);
    onGenerateSummary && onGenerateSummary(video.videoId, type);
  };

  return (
    <>
      <div className="video-row">
        {/* Thumbnail */}
        <div className="video-row-thumbnail">
          <a href={video.videoUrl} target="_blank" rel="noopener noreferrer">
            <img
              src={thumbnailUrl}
              alt={video.videoTitle}
              onError={(e) => {
                e.target.src = 'https://via.placeholder.com/160x90?text=No+Thumbnail';
              }}
            />
          </a>
        </div>

        {/* Title / Channel / Date */}
        <div className="video-row-info">
          <h3 className="video-row-title">
            <a href={video.videoUrl} target="_blank" rel="noopener noreferrer">
              {video.videoTitle}
            </a>
          </h3>
          <p className="video-row-channel">
            {video.channelName && (
              <a href={video.channelUrl} target="_blank" rel="noopener noreferrer">
                {video.channelName}
              </a>
            )}
          </p>
          <span className="video-row-date">Saved: {formatDate(video.scrapedAt)}</span>
        </div>

        {/* Transcript Column */}
        <div className="video-row-transcript">
          {hasTranscript ? (
            <div className="transcript-actions-group">
              <button
                className="status-indicator available clickable"
                onClick={() => onViewTranscript && onViewTranscript(video.videoId, video.videoTitle)}
                title="View Transcript"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <span>View</span>
              </button>
              {onRetranscribe && (
                <button
                  className="btn btn-sm btn-icon"
                  onClick={() => onRetranscribe(video.videoId)}
                  title="Re-transcribe"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                </button>
              )}
              {hasSummary ? (
                <>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => onToggleSummary && onToggleSummary(video.videoId)}
                    title="Toggle Summary"
                  >
                    {summaryState?.expanded ? 'Hide' : 'Summary'}
                  </button>
                  <div className="summary-menu-wrapper" ref={menuRef}>
                    <button
                      className="btn btn-sm btn-icon"
                      onClick={() => setShowSummaryMenu(!showSummaryMenu)}
                      disabled={summaryState?.loading}
                      title="Re-summarize"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="23 4 23 10 17 10" />
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                      </svg>
                    </button>
                    {showSummaryMenu && (
                      <div className="summary-type-menu">
                        <button onClick={() => handleSummarize('structured')}>Structured</button>
                        <button onClick={() => handleSummarize('narrative')}>Narrative</button>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="summary-menu-wrapper" ref={menuRef}>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={() => setShowSummaryMenu(!showSummaryMenu)}
                    disabled={summaryState?.loading}
                    title="Generate Summary"
                  >
                    {summaryState?.loading ? 'Summarizing...' : 'Summarize'}
                  </button>
                  {showSummaryMenu && !summaryState?.loading && (
                    <div className="summary-type-menu">
                      <button onClick={() => handleSummarize('structured')}>Structured</button>
                      <button onClick={() => handleSummarize('narrative')}>Narrative</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : transcriptJobStatus ? (
            <div className="status-indicator transcribing">
              <span className="spinner" />
              <span>
                {transcriptJobStatus === 'downloading' ? 'Downloading...' :
                 transcriptJobStatus === 'transcribing' ? 'Transcribing...' :
                 'Starting...'}
              </span>
            </div>
          ) : (
            <>
              <div className="status-indicator unavailable">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <span>None</span>
              </div>
              {onTranscribe && (
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => onTranscribe(video.videoId)}
                  title="Transcribe Video"
                >
                  Transcribe
                </button>
              )}
            </>
          )}
        </div>

        {/* Actions */}
        <div className="video-row-actions">
          <button
            className="btn btn-sm btn-danger"
            onClick={() => onDelete(video.videoId)}
            title="Remove video"
          >
            Remove
          </button>
        </div>
      </div>

      {/* Expandable summary row */}
      {summaryState?.expanded && summaryState?.content && (
        <div className="video-summary-row">
          <div className="video-summary-content">
            {summaryState.content}
          </div>
        </div>
      )}
    </>
  );
}

export default VideoCard;
