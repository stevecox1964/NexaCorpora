import React from 'react';

function VideoCard({
  video,
  onDelete,
  onProcess,
  onDeleteTranscript,
  onViewTranscript,
  onRefreshSummaryFaq,
  onToggleSummary,
  onToggleFaq,
  onNavigateToBrain,
  summaryState,
  faqState,
}) {
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
  const hasFaq = video.hasFaq || false;
  const transcriptJobStatus = video.transcriptJobStatus || null;
  const isProcessing = !!transcriptJobStatus;

  const statusText = transcriptJobStatus === 'downloading' ? 'Downloading...' :
    transcriptJobStatus === 'transcribing' ? 'Transcribing...' :
    transcriptJobStatus === 'summarizing' ? 'Summarizing...' :
    transcriptJobStatus ? 'Processing...' : '';

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
          {video.brains && video.brains.length > 0 && (
            <div className="video-brain-badges">
              {video.brains.map(brain => (
                <button
                  key={brain.id}
                  className="brain-badge"
                  onClick={() => onNavigateToBrain && onNavigateToBrain(brain.id)}
                  title={`Go to brain: ${brain.name}`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2a8 8 0 0 0-8 8c0 3.5 2 6 4 7.5V20h8v-2.5c2-1.5 4-4 4-7.5a8 8 0 0 0-8-8z" />
                    <path d="M9 22h6" />
                  </svg>
                  <span>{brain.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Summary Column */}
        <div className="video-row-summary">
          {isProcessing && transcriptJobStatus === 'summarizing' ? (
            <div className="status-indicator transcribing">
              <span className="spinner" />
              <span>...</span>
            </div>
          ) : hasSummary ? (
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => onToggleSummary && onToggleSummary(video.videoId)}
            >
              {summaryState?.expanded ? 'Hide' : 'View'}
            </button>
          ) : (
            <span className="status-none">None</span>
          )}
        </div>

        {/* FAQ Column */}
        <div className="video-row-faq">
          {isProcessing && transcriptJobStatus === 'summarizing' ? (
            <div className="status-indicator transcribing">
              <span className="spinner" />
              <span>...</span>
            </div>
          ) : hasFaq ? (
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => onToggleFaq && onToggleFaq(video.videoId)}
            >
              {faqState?.expanded ? 'Hide' : 'View'}
            </button>
          ) : (
            <span className="status-none">None</span>
          )}
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
              {video.transcriptProvider && (
                <span className={`provider-badge provider-${video.transcriptProvider}`}>
                  {video.transcriptProvider === 'assemblyai' ? 'AAI' : 'Gemini'}
                </span>
              )}
              {onDeleteTranscript && (
                <button
                  className="btn btn-sm btn-icon"
                  onClick={() => onDeleteTranscript(video.videoId)}
                  title="Delete Transcript"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              )}
            </div>
          ) : isProcessing ? (
            <div className="status-indicator transcribing">
              <span className="spinner" />
              <span>{statusText}</span>
            </div>
          ) : (
            <span className="status-none">None</span>
          )}
        </div>

        {/* Actions */}
        <div className="video-row-actions">
          {!hasTranscript && !isProcessing && onProcess && (
            <button
              className="btn btn-sm btn-primary"
              onClick={() => onProcess(video.videoId)}
              title="Transcribe + Summarize + FAQ"
            >
              Process
            </button>
          )}
          {hasTranscript && onRefreshSummaryFaq && (
            <button
              className="btn btn-sm btn-icon"
              onClick={() => onRefreshSummaryFaq(video.videoId)}
              title="Refresh Summary & FAQ"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>
          )}
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

      {/* Expandable FAQ row */}
      {faqState?.expanded && faqState?.content && (
        <div className="video-faq-row">
          <div className="video-summary-content">
            {faqState.content}
          </div>
        </div>
      )}
    </>
  );
}

export default VideoCard;
