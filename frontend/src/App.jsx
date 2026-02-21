import React, { useState, useEffect, useRef, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import VideoCard from './components/VideoCard';
import AddVideoModal from './components/AddVideoModal';
import TranscriptModal from './components/TranscriptModal';
import ChatDrawer from './components/ChatDrawer';
import SettingsPage from './components/SettingsPage';
import ProfilePage from './components/ProfilePage';
import { apiService } from './services/api';

function App() {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [serverOffline, setServerOffline] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [transcriptView, setTranscriptView] = useState(null); // { videoId, videoTitle }
  const [pagination, setPagination] = useState({
    page: 1,
    per_page: 20,
    total: 0,
    total_pages: 1,
    has_prev: false,
    has_next: false
  });
  const [activePage, setActivePage] = useState('videos');
  const [summaryStates, setSummaryStates] = useState({});

  // Track active polling intervals for transcription jobs
  const pollIntervals = useRef({});

  const fetchVideos = async (page = 1) => {
    setLoading(true);
    setError(null);
    setServerOffline(false);

    try {
      const data = await apiService.getVideos(page, pagination.per_page);
      setVideos(data.videos || []);
      if (data.pagination) {
        setPagination(data.pagination);
      }
    } catch (err) {
      if (err.message.includes('fetch') || err.message.includes('network')) {
        setServerOffline(true);
        setError('Docker server is not running. Please start the Docker container with: docker-compose up');
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVideos(1);
    return () => {
      // Clean up all polling intervals on unmount
      Object.values(pollIntervals.current).forEach(clearInterval);
    };
  }, []);

  const handlePageChange = (newPage) => {
    fetchVideos(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAddVideo = async (videoData) => {
    await apiService.addVideo(videoData);
    await fetchVideos(1);
  };

  const handleDeleteVideo = async (videoId) => {
    if (!confirm('Are you sure you want to remove this video?')) {
      return;
    }

    try {
      await apiService.deleteVideo(videoId);
      setVideos(prev => prev.filter(v => v.videoId !== videoId));
    } catch (err) {
      setError(err.message);
    }
  };

  const handleImportBookmarks = async () => {
    try {
      setLoading(true);
      const data = await apiService.getChromeBookmarks();
      if (data.bookmarks && data.bookmarks.length > 0) {
        alert(`Found ${data.bookmarks.length} YouTube bookmarks in Chrome`);
        await fetchVideos();
      } else {
        alert('No YouTube bookmarks found in Chrome');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateVideoJobStatus = useCallback((videoId, status) => {
    setVideos(prev => prev.map(v =>
      v.videoId === videoId ? { ...v, transcriptJobStatus: status } : v
    ));
  }, []);

  const markVideoTranscribed = useCallback((videoId) => {
    setVideos(prev => prev.map(v =>
      v.videoId === videoId
        ? { ...v, hasTranscript: true, transcriptJobStatus: null }
        : v
    ));
  }, []);

  const stopPolling = useCallback((videoId) => {
    if (pollIntervals.current[videoId]) {
      clearInterval(pollIntervals.current[videoId]);
      delete pollIntervals.current[videoId];
    }
  }, []);

  const handleTranscribe = async (videoId) => {
    try {
      const data = await apiService.startTranscription(videoId);
      const jobId = data.job.id;

      // Immediately show "Starting..." in the UI
      updateVideoJobStatus(videoId, 'pending');

      // Poll for job status every 4 seconds
      const interval = setInterval(async () => {
        try {
          const statusData = await apiService.getJobStatus(jobId);
          const job = statusData.job;

          if (!job) {
            stopPolling(videoId);
            updateVideoJobStatus(videoId, null);
            return;
          }

          updateVideoJobStatus(videoId, job.status);

          if (job.status === 'completed') {
            stopPolling(videoId);
            markVideoTranscribed(videoId);
          } else if (job.status === 'failed') {
            stopPolling(videoId);
            updateVideoJobStatus(videoId, null);
            setError(`Transcription failed for video: ${job.errorMessage || 'Unknown error'}`);
          }
        } catch (err) {
          stopPolling(videoId);
          updateVideoJobStatus(videoId, null);
          setError(`Error polling transcription status: ${err.message}`);
        }
      }, 4000);

      pollIntervals.current[videoId] = interval;

    } catch (err) {
      setError(err.message);
    }
  };

  const handleGenerateSummary = async (videoId) => {
    setSummaryStates(prev => ({
      ...prev,
      [videoId]: { ...prev[videoId], loading: true }
    }));

    try {
      const data = await apiService.generateSummary(videoId);
      const summary = data.transcript?.summary;

      setVideos(prev => prev.map(v =>
        v.videoId === videoId ? { ...v, hasSummary: true } : v
      ));

      setSummaryStates(prev => ({
        ...prev,
        [videoId]: { expanded: true, content: summary, loading: false }
      }));
    } catch (err) {
      setError(err.message);
      setSummaryStates(prev => ({
        ...prev,
        [videoId]: { ...prev[videoId], loading: false }
      }));
    }
  };

  const handleToggleSummary = async (videoId) => {
    const current = summaryStates[videoId];

    if (current?.expanded) {
      setSummaryStates(prev => ({
        ...prev,
        [videoId]: { ...prev[videoId], expanded: false }
      }));
      return;
    }

    // Expand — fetch summary if not cached
    if (current?.content) {
      setSummaryStates(prev => ({
        ...prev,
        [videoId]: { ...prev[videoId], expanded: true }
      }));
    } else {
      setSummaryStates(prev => ({
        ...prev,
        [videoId]: { expanded: false, content: null, loading: true }
      }));
      try {
        const data = await apiService.getSummary(videoId);
        setSummaryStates(prev => ({
          ...prev,
          [videoId]: { expanded: true, content: data.summary, loading: false }
        }));
      } catch (err) {
        setError(err.message);
        setSummaryStates(prev => ({
          ...prev,
          [videoId]: { ...prev[videoId], loading: false }
        }));
      }
    }
  };

  const handleBulkSummarize = async () => {
    try {
      setLoading(true);
      const data = await apiService.generateBulkSummaries();
      const msg = `Generated ${data.generated} summaries.${data.errors?.length ? ` ${data.errors.length} errors.` : ''}`;
      alert(msg);
      await fetchVideos(pagination.page);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-layout">
      <Sidebar activePage={activePage} onNavigate={setActivePage} />

      <main className="main-content">
        {activePage === 'videos' && (
          <>
            <header className="header">
              <h1>YouTube Bookmark Manager</h1>
              <div className="header-actions">
                <button
                  className="btn btn-secondary"
                  onClick={handleBulkSummarize}
                  disabled={serverOffline || loading}
                >
                  Summarize All
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={handleImportBookmarks}
                  disabled={serverOffline}
                >
                  Import Chrome Bookmarks
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => setShowAddModal(true)}
                  disabled={serverOffline}
                >
                  Add Video
                </button>
              </div>
            </header>

            {serverOffline && (
              <div className="error-banner">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>
                  <strong>Docker server is offline.</strong> Please start the Docker container by running:
                  <code style={{ marginLeft: '8px', background: 'rgba(0,0,0,0.3)', padding: '2px 8px', borderRadius: '4px' }}>
                    docker-compose up
                  </code>
                </span>
              </div>
            )}

            {error && !serverOffline && (
              <div className="error-banner">
                <span>{error}</span>
                <button
                  className="btn btn-secondary"
                  onClick={() => setError(null)}
                  style={{ marginLeft: 'auto' }}
                >
                  Dismiss
                </button>
              </div>
            )}

            {loading ? (
              <div className="loading">Loading videos...</div>
            ) : videos.length === 0 && !serverOffline ? (
              <div className="empty-state">
                <h2>No videos saved yet</h2>
                <p>Add YouTube videos to start building your collection</p>
              </div>
            ) : (
              <>
                <div className="video-list">
                  {/* List Header */}
                  <div className="video-list-header">
                    <span>Thumbnail</span>
                    <span>Video Info</span>
                    <span>Transcript</span>
                    <span>Actions</span>
                  </div>

                  {/* Video Rows */}
                  {videos.map(video => (
                    <VideoCard
                      key={video.videoId}
                      video={video}
                      onDelete={handleDeleteVideo}
                      onTranscribe={handleTranscribe}
                      onViewTranscript={(videoId, videoTitle) => setTranscriptView({ videoId, videoTitle })}
                      onGenerateSummary={handleGenerateSummary}
                      onToggleSummary={handleToggleSummary}
                      summaryState={summaryStates[video.videoId]}
                    />
                  ))}
                </div>

                {/* Pagination Controls */}
                {pagination.total_pages > 1 && (
                  <div className="pagination">
                    <button
                      className="btn btn-secondary"
                      onClick={() => handlePageChange(pagination.page - 1)}
                      disabled={!pagination.has_prev}
                    >
                      ← Previous
                    </button>

                    <div className="pagination-info">
                      <span className="pagination-pages">
                        Page {pagination.page} of {pagination.total_pages}
                      </span>
                      <span className="pagination-total">
                        ({pagination.total} videos)
                      </span>
                    </div>

                    <button
                      className="btn btn-secondary"
                      onClick={() => handlePageChange(pagination.page + 1)}
                      disabled={!pagination.has_next}
                    >
                      Next →
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {activePage === 'settings' && <SettingsPage />}
        {activePage === 'profile' && <ProfilePage />}

        {showAddModal && (
          <AddVideoModal
            onClose={() => setShowAddModal(false)}
            onAdd={handleAddVideo}
          />
        )}

        {transcriptView && (
          <TranscriptModal
            videoId={transcriptView.videoId}
            videoTitle={transcriptView.videoTitle}
            onClose={() => setTranscriptView(null)}
          />
        )}

        <ChatDrawer />
      </main>
    </div>
  );
}

export default App;
