import React from 'react';

function VideoCard({ video, onDelete, onTranscribe, onViewTranscript, onGenerateSummary, onToggleSummary, summaryState }) {
  const thumbnailUrl = `https://img.youtube.com/vi/${video.videoId}/mqdefault.jpg`;

  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown date';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const hasTranscript = video.hasTranscript || false;
  const hasSummary = video.hasSummary || false;
  const transcriptJobStatus = video.transcriptJobStatus || null;

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
              {hasSummary ? (
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => onToggleSummary && onToggleSummary(video.videoId)}
                  title="Toggle Summary"
                >
                  {summaryState?.expanded ? 'Hide' : 'Summary'}
                </button>
              ) : (
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => onGenerateSummary && onGenerateSummary(video.videoId)}
                  disabled={summaryState?.loading}
                  title="Generate Summary"
                >
                  {summaryState?.loading ? 'Summarizing...' : 'Summarize'}
                </button>
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
