import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiService } from '../services/api';
import TranscriptModal from './TranscriptModal';

function TopicsPage() {
  const [clusters, setClusters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState(null);
  const [summaryStates, setSummaryStates] = useState({});
  const [transcriptView, setTranscriptView] = useState(null);
  const [transcribingJobs, setTranscribingJobs] = useState({});
  const pollIntervals = useRef({});

  useEffect(() => {
    loadClusters();
    return () => {
      Object.values(pollIntervals.current).forEach(clearInterval);
    };
  }, []);

  const loadClusters = async () => {
    try {
      const data = await apiService.getClusters();
      const clusterList = data.clusters || [];

      if (clusterList.length > 0) {
        const videoResults = await Promise.all(
          clusterList.map(c => apiService.getClusterVideos(c.clusterId).catch(() => ({ videos: [] })))
        );
        clusterList.forEach((c, i) => {
          c.videos = videoResults[i].videos || [];
        });
      }

      setClusters(clusterList);
    } catch (err) {
      console.error('Failed to load clusters:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleBuild = async () => {
    setBuilding(true);
    setError(null);
    try {
      await apiService.buildClusters();
      setLoading(true);
      await loadClusters();
    } catch (err) {
      setError(err.message);
    } finally {
      setBuilding(false);
    }
  };

  // --- Transcription ---

  const stopPolling = useCallback((videoId) => {
    if (pollIntervals.current[videoId]) {
      clearInterval(pollIntervals.current[videoId]);
      delete pollIntervals.current[videoId];
    }
  }, []);

  const updateVideoInClusters = useCallback((videoId, updates) => {
    setClusters(prev => prev.map(c => ({
      ...c,
      videos: c.videos.map(v => v.videoId === videoId ? { ...v, ...updates } : v)
    })));
  }, []);

  const handleTranscribe = async (videoId) => {
    try {
      const data = await apiService.startTranscription(videoId);
      const jobId = data.job.id;

      setTranscribingJobs(prev => ({ ...prev, [videoId]: { jobId, status: 'pending' } }));

      const interval = setInterval(async () => {
        try {
          const statusData = await apiService.getJobStatus(jobId);
          const job = statusData.job;

          if (!job) {
            stopPolling(videoId);
            setTranscribingJobs(prev => { const n = { ...prev }; delete n[videoId]; return n; });
            return;
          }

          setTranscribingJobs(prev => ({ ...prev, [videoId]: { jobId, status: job.status } }));

          if (job.status === 'completed') {
            stopPolling(videoId);
            setTranscribingJobs(prev => { const n = { ...prev }; delete n[videoId]; return n; });
            updateVideoInClusters(videoId, { hasTranscript: true });
          } else if (job.status === 'failed') {
            stopPolling(videoId);
            setTranscribingJobs(prev => { const n = { ...prev }; delete n[videoId]; return n; });
            setError(`Transcription failed: ${job.errorMessage || 'Unknown error'}`);
          }
        } catch (err) {
          stopPolling(videoId);
          setTranscribingJobs(prev => { const n = { ...prev }; delete n[videoId]; return n; });
        }
      }, 4000);

      pollIntervals.current[videoId] = interval;
    } catch (err) {
      setError(err.message);
    }
  };

  // --- Summaries ---

  const handleGenerateSummary = async (videoId) => {
    setSummaryStates(prev => ({ ...prev, [videoId]: { loading: true } }));
    try {
      const data = await apiService.generateSummary(videoId);
      const summary = data.transcript?.summary;
      updateVideoInClusters(videoId, { hasSummary: true });
      setSummaryStates(prev => ({ ...prev, [videoId]: { expanded: true, content: summary, loading: false } }));
    } catch (err) {
      setError(err.message);
      setSummaryStates(prev => ({ ...prev, [videoId]: { loading: false } }));
    }
  };

  const handleToggleSummary = async (videoId) => {
    const current = summaryStates[videoId];

    if (current?.expanded) {
      setSummaryStates(prev => ({ ...prev, [videoId]: { ...prev[videoId], expanded: false } }));
      return;
    }

    if (current?.content) {
      setSummaryStates(prev => ({ ...prev, [videoId]: { ...prev[videoId], expanded: true } }));
    } else {
      setSummaryStates(prev => ({ ...prev, [videoId]: { expanded: false, content: null, loading: true } }));
      try {
        const data = await apiService.getSummary(videoId);
        setSummaryStates(prev => ({ ...prev, [videoId]: { expanded: true, content: data.summary, loading: false } }));
      } catch (err) {
        setError(err.message);
        setSummaryStates(prev => ({ ...prev, [videoId]: { loading: false } }));
      }
    }
  };

  // --- Render ---

  if (loading) {
    return <div className="loading">Loading topics...</div>;
  }

  return (
    <div className="topics-page">
      <div className="topics-header">
        <h2>Topics</h2>
        <button
          className="btn btn-primary"
          onClick={handleBuild}
          disabled={building}
        >
          {building ? 'Building...' : clusters.length > 0 ? 'Rebuild Topics' : 'Build Topics'}
        </button>
      </div>

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button className="btn btn-secondary" onClick={() => setError(null)} style={{ marginLeft: 'auto' }}>
            Dismiss
          </button>
        </div>
      )}

      {building && (
        <div className="topics-building">
          <div className="spinner" />
          <span>Clustering videos and generating labels with Gemini...</span>
        </div>
      )}

      {clusters.length === 0 && !building ? (
        <div className="empty-state">
          <h2>No topics yet</h2>
          <p>Build embeddings in Settings, then click "Build Topics" to auto-cluster your videos by theme</p>
        </div>
      ) : (
        clusters.map(cluster => (
          <div key={cluster.clusterId} className="topic-group">
            <div className="topic-group-header">
              <h3>{cluster.label}</h3>
              <span className="topic-group-count">
                {cluster.videoCount} video{cluster.videoCount !== 1 ? 's' : ''}
              </span>
            </div>

            <div className="topic-videos-list">
              {(cluster.videos || []).map(video => {
                const jobState = transcribingJobs[video.videoId];
                const summaryState = summaryStates[video.videoId];

                return (
                  <React.Fragment key={video.videoId}>
                    <div className="topic-video-row">
                      <a
                        className="topic-video-thumbnail"
                        href={`https://www.youtube.com/watch?v=${video.videoId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <img
                          src={`https://img.youtube.com/vi/${video.videoId}/mqdefault.jpg`}
                          alt={video.videoTitle}
                        />
                      </a>
                      <div className="topic-video-info">
                        <a
                          className="topic-video-title"
                          href={`https://www.youtube.com/watch?v=${video.videoId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {video.videoTitle}
                        </a>
                        <div className="topic-video-channel">{video.channelName}</div>
                      </div>

                      {/* Transcript Actions */}
                      <div className="topic-video-actions">
                        {video.hasTranscript ? (
                          <div className="transcript-actions-group">
                            <button
                              className="status-indicator available clickable"
                              onClick={() => setTranscriptView({ videoId: video.videoId, videoTitle: video.videoTitle })}
                              title="View Transcript"
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                              </svg>
                              <span>View</span>
                            </button>
                            {video.hasSummary ? (
                              <button
                                className="btn btn-sm btn-secondary"
                                onClick={() => handleToggleSummary(video.videoId)}
                                title="Toggle Summary"
                              >
                                {summaryState?.expanded ? 'Hide' : 'Summary'}
                              </button>
                            ) : (
                              <button
                                className="btn btn-sm btn-secondary"
                                onClick={() => handleGenerateSummary(video.videoId)}
                                disabled={summaryState?.loading}
                                title="Generate Summary"
                              >
                                {summaryState?.loading ? 'Summarizing...' : 'Summarize'}
                              </button>
                            )}
                          </div>
                        ) : jobState ? (
                          <div className="status-indicator transcribing">
                            <span className="spinner" />
                            <span>
                              {jobState.status === 'downloading' ? 'Downloading...' :
                               jobState.status === 'transcribing' ? 'Transcribing...' :
                               jobState.status === 'embedding' ? 'Embedding...' :
                               'Starting...'}
                            </span>
                          </div>
                        ) : (
                          <button
                            className="btn btn-sm btn-secondary"
                            onClick={() => handleTranscribe(video.videoId)}
                            title="Transcribe Video"
                          >
                            Transcribe
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Expandable summary */}
                    {summaryState?.expanded && summaryState?.content && (
                      <div className="video-summary-row">
                        <div className="video-summary-content">
                          {summaryState.content}
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        ))
      )}

      {transcriptView && (
        <TranscriptModal
          videoId={transcriptView.videoId}
          videoTitle={transcriptView.videoTitle}
          onClose={() => setTranscriptView(null)}
        />
      )}
    </div>
  );
}

export default TopicsPage;
