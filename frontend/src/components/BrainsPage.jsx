import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiService } from '../services/api';
import { renderChatContent } from '../utils/chatUtils';
import TranscriptModal from './TranscriptModal';

function BrainsPage() {
  const [brains, setBrains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedBrainId, setSelectedBrainId] = useState(null);
  const [brainDetail, setBrainDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('videos');
  const [showNewModal, setShowNewModal] = useState(false);
  const [showAddVideos, setShowAddVideos] = useState(false);
  const [transcriptView, setTranscriptView] = useState(null);
  const [transcribingJobs, setTranscribingJobs] = useState({});
  const pollIntervals = useRef({});

  // Chat state
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatStreaming, setChatStreaming] = useState(false);
  const [playerVideoId, setPlayerVideoId] = useState(null);
  const chatEndRef = useRef(null);
  const chatInputRef = useRef(null);
  const playerRef = useRef(null);
  const apiLoadedRef = useRef(false);

  // Load brains list
  const loadBrains = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiService.getBrains();
      setBrains(data.brains || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadBrains(); }, []);

  // Load brain detail
  const loadBrainDetail = async (brainId) => {
    setDetailLoading(true);
    try {
      const data = await apiService.getBrain(brainId);
      setBrainDetail(data.brain);
    } catch (err) {
      setError(err.message);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSelectBrain = (brainId) => {
    setSelectedBrainId(brainId);
    setActiveTab('videos');
    setChatMessages([]);
    setChatInput('');
    closePlayer();
    loadBrainDetail(brainId);
  };

  const handleBack = () => {
    setSelectedBrainId(null);
    setBrainDetail(null);
    closePlayer();
    loadBrains();
  };

  const handleDeleteBrain = async () => {
    if (!confirm('Delete this brain? Videos will not be deleted.')) return;
    try {
      await apiService.deleteBrain(selectedBrainId);
      handleBack();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRemoveVideo = async (videoId) => {
    try {
      await apiService.removeBrainVideo(selectedBrainId, videoId);
      loadBrainDetail(selectedBrainId);
    } catch (err) {
      setError(err.message);
    }
  };

  // Clean up polling intervals on unmount
  useEffect(() => {
    return () => {
      Object.values(pollIntervals.current).forEach(clearInterval);
    };
  }, []);

  const handleTranscribe = async (videoId) => {
    try {
      const data = await apiService.startTranscription(videoId);
      const jobId = data.job.id;

      setTranscribingJobs(prev => ({ ...prev, [videoId]: 'pending' }));

      const interval = setInterval(async () => {
        try {
          const statusData = await apiService.getJobStatus(jobId);
          const job = statusData.job;

          if (!job) {
            clearInterval(interval);
            delete pollIntervals.current[videoId];
            setTranscribingJobs(prev => { const n = { ...prev }; delete n[videoId]; return n; });
            return;
          }

          setTranscribingJobs(prev => ({ ...prev, [videoId]: job.status }));

          if (job.status === 'completed') {
            clearInterval(interval);
            delete pollIntervals.current[videoId];
            setTranscribingJobs(prev => { const n = { ...prev }; delete n[videoId]; return n; });
            loadBrainDetail(selectedBrainId);
          } else if (job.status === 'failed') {
            clearInterval(interval);
            delete pollIntervals.current[videoId];
            setTranscribingJobs(prev => { const n = { ...prev }; delete n[videoId]; return n; });
            setError(`Transcription failed: ${job.errorMessage || 'Unknown error'}`);
          }
        } catch (err) {
          clearInterval(interval);
          delete pollIntervals.current[videoId];
          setTranscribingJobs(prev => { const n = { ...prev }; delete n[videoId]; return n; });
          setError(`Error polling transcription: ${err.message}`);
        }
      }, 4000);

      pollIntervals.current[videoId] = interval;
    } catch (err) {
      setError(err.message);
    }
  };

  // YouTube player
  useEffect(() => {
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
  }, []);

  useEffect(() => {
    return () => {
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch (e) { /* */ }
        playerRef.current = null;
      }
    };
  }, []);

  const createOrSeekPlayer = useCallback((seconds, videoId) => {
    if (playerRef.current && playerVideoId === videoId) {
      playerRef.current.seekTo(seconds, true);
      playerRef.current.playVideo();
      return;
    }
    if (playerRef.current) {
      try { playerRef.current.destroy(); } catch (e) { /* */ }
      playerRef.current = null;
    }
    setPlayerVideoId(videoId);
    if (!apiLoadedRef.current && !(window.YT && window.YT.Player)) return;
    apiLoadedRef.current = true;
    setTimeout(() => {
      const container = document.getElementById('yt-player-brain');
      if (!container) return;
      playerRef.current = new window.YT.Player('yt-player-brain', {
        videoId,
        playerVars: { autoplay: 1, start: seconds, modestbranding: 1, rel: 0 },
        events: {
          onReady: (event) => {
            event.target.seekTo(seconds, true);
            event.target.playVideo();
          },
        },
      });
    }, 50);
  }, [playerVideoId]);

  const handleTimestampClick = useCallback((seconds, timestamp, videoId) => {
    createOrSeekPlayer(seconds, videoId);
  }, [createOrSeekPlayer]);

  const closePlayer = useCallback(() => {
    if (playerRef.current) {
      try { playerRef.current.destroy(); } catch (e) { /* */ }
      playerRef.current = null;
    }
    setPlayerVideoId(null);
  }, []);

  // Chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  useEffect(() => {
    if (activeTab === 'chat' && chatInputRef.current) {
      chatInputRef.current.focus();
    }
  }, [activeTab]);

  const handleChatSend = async () => {
    const text = chatInput.trim();
    if (!text || chatStreaming || !selectedBrainId) return;

    const userMessage = { role: 'user', content: text };
    const history = [...chatMessages];

    setChatMessages(prev => [...prev, userMessage, { role: 'assistant', content: '' }]);
    setChatInput('');
    setChatStreaming(true);

    await apiService.brainChatStream(
      selectedBrainId,
      text,
      history,
      (chunk) => {
        setChatMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          updated[updated.length - 1] = { ...last, content: last.content + chunk };
          return updated;
        });
      },
      () => setChatStreaming(false),
      (error) => {
        setChatMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: `Error: ${error}` };
          return updated;
        });
        setChatStreaming(false);
      }
    );
  };

  const handleChatKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleChatSend();
    }
  };

  // Render brain list
  if (!selectedBrainId) {
    return (
      <div className="brains-page">
        <header className="brains-header">
          <h2>AI Brains</h2>
          <button className="btn btn-primary btn-sm" onClick={() => setShowNewModal(true)}>
            + New Brain
          </button>
        </header>

        {error && <div className="error-banner">{error}</div>}

        {loading ? (
          <div className="loading-text">Loading brains...</div>
        ) : brains.length === 0 ? (
          <div className="brains-empty">
            <p>No brains yet. Create one to build a curated AI knowledge base from your videos.</p>
          </div>
        ) : (
          <div className="brain-cards">
            {brains.map(brain => (
              <div key={brain.id} className="brain-card" onClick={() => handleSelectBrain(brain.id)}>
                <div className="brain-card-thumbnails">
                  {(brain.thumbnailVideoIds || []).slice(0, 4).map(vid => (
                    <img
                      key={vid}
                      src={`https://img.youtube.com/vi/${vid}/mqdefault.jpg`}
                      alt=""
                    />
                  ))}
                  {(!brain.thumbnailVideoIds || brain.thumbnailVideoIds.length === 0) && (
                    <div className="brain-card-empty-thumb">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="1.5">
                        <path d="M12 2a8 8 0 0 0-8 8c0 3.5 2 6 4 7.5V20h8v-2.5c2-1.5 4-4 4-7.5a8 8 0 0 0-8-8z" />
                        <path d="M9 22h6" />
                      </svg>
                    </div>
                  )}
                </div>
                <div className="brain-card-info">
                  <h3>{brain.name}</h3>
                  {brain.description && <p>{brain.description}</p>}
                  <span className="brain-card-meta">{brain.videoCount} video{brain.videoCount !== 1 ? 's' : ''}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {showNewModal && (
          <NewBrainModal
            onClose={() => setShowNewModal(false)}
            onCreated={(brain) => {
              setShowNewModal(false);
              loadBrains();
            }}
          />
        )}
      </div>
    );
  }

  // Render brain detail
  return (
    <div className="brains-page">
      <div className="brain-detail-header">
        <button className="brain-back-btn" onClick={handleBack}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>
        <div className="brain-detail-title">
          <h2>{brainDetail?.name || 'Loading...'}</h2>
          {brainDetail?.description && <p>{brainDetail.description}</p>}
        </div>
        <span className="brain-detail-count">{brainDetail?.videoCount || 0} videos</span>
        <button className="btn btn-sm btn-danger" onClick={handleDeleteBrain}>Delete</button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="brain-tabs">
        <button
          className={`brain-tab ${activeTab === 'videos' ? 'active' : ''}`}
          onClick={() => setActiveTab('videos')}
        >
          Videos
        </button>
        <button
          className={`brain-tab ${activeTab === 'chat' ? 'active' : ''}`}
          onClick={() => setActiveTab('chat')}
        >
          Chat
        </button>
      </div>

      {activeTab === 'videos' && (
        <div className="brain-videos-section">
          <div className="brain-videos-toolbar">
            <button className="btn btn-sm btn-secondary" onClick={() => setShowAddVideos(true)}>
              + Add Videos
            </button>
          </div>

          {detailLoading ? (
            <div className="loading-text">Loading videos...</div>
          ) : !brainDetail?.videos?.length ? (
            <div className="brains-empty">
              <p>No videos in this brain yet. Add some to start building your knowledge base.</p>
            </div>
          ) : (
            <div className="topic-videos-list">
              {brainDetail.videos.map(video => (
                <div key={video.videoId} className="topic-video-row">
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
                  <div className="topic-video-actions">
                    {video.hasTranscript ? (
                      <>
                        <button
                          className="status-indicator available clickable"
                          onClick={() => setTranscriptView({ videoId: video.videoId, videoTitle: video.videoTitle })}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                          </svg>
                          <span>View</span>
                        </button>
                        {video.transcriptProvider && (
                          <span className={`provider-badge provider-${video.transcriptProvider}`}>
                            {video.transcriptProvider === 'assemblyai' ? 'AAI' : 'Gemini'}
                          </span>
                        )}
                      </>
                    ) : transcribingJobs[video.videoId] ? (
                      <span className="status-indicator transcribing">
                        <span className="spinner" />
                        <span>{transcribingJobs[video.videoId] === 'downloading' ? 'Downloading...' : 'Transcribing...'}</span>
                      </span>
                    ) : (
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => handleTranscribe(video.videoId)}
                      >
                        Transcribe
                      </button>
                    )}
                    <button
                      className="btn-icon"
                      onClick={() => handleRemoveVideo(video.videoId)}
                      title="Remove from brain"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'chat' && (
        <div className="brain-chat">
          {playerVideoId && (
            <div className="chat-player-wrapper">
              <div id="yt-player-brain"></div>
              <button className="chat-player-close" onClick={closePlayer} title="Close player">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}
          <div className="brain-chat-messages">
            {chatMessages.length === 0 && (
              <div className="chat-empty">
                Ask a question about the videos in "{brainDetail?.name}"...
              </div>
            )}
            {chatMessages.map((msg, i) => (
              <div key={i} className={`chat-message chat-message-${msg.role}`}>
                <div className="chat-message-content">
                  {msg.role === 'assistant' && msg.content
                    ? renderChatContent(msg.content, handleTimestampClick)
                    : msg.content || (chatStreaming && i === chatMessages.length - 1 ? '...' : '')}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="brain-chat-input">
            <input
              ref={chatInputRef}
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={handleChatKeyDown}
              placeholder={`Ask about ${brainDetail?.name || 'this brain'}...`}
              disabled={chatStreaming}
            />
            <button
              className="btn btn-primary btn-sm"
              onClick={handleChatSend}
              disabled={chatStreaming || !chatInput.trim()}
            >
              {chatStreaming ? '...' : 'Send'}
            </button>
          </div>
        </div>
      )}

      {showAddVideos && brainDetail && (
        <AddVideosToBrainModal
          brainId={selectedBrainId}
          existingVideoIds={(brainDetail.videos || []).map(v => v.videoId)}
          onClose={() => setShowAddVideos(false)}
          onAdded={() => {
            setShowAddVideos(false);
            loadBrainDetail(selectedBrainId);
          }}
        />
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

// --- New Brain Modal ---
function NewBrainModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleCreate = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const data = await apiService.createBrain(name.trim(), description.trim());
      onCreated(data.brain);
    } catch (err) {
      alert(err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal brain-new-modal" onClick={(e) => e.stopPropagation()}>
        <h2>New Brain</h2>
        <div className="brain-new-form">
          <label>Name</label>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. GoHighLevel, AI Tools, Web Dev..."
            maxLength={100}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
          <label>Description (optional)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this brain about?"
            maxLength={500}
            rows={3}
          />
        </div>
        <div className="modal-actions">
          <button className="btn btn-sm btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-sm btn-primary"
            onClick={handleCreate}
            disabled={!name.trim() || creating}
          >
            {creating ? 'Creating...' : 'Create Brain'}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Add Videos to Brain Modal ---
function AddVideosToBrainModal({ brainId, existingVideoIds, onClose, onAdded }) {
  const [allVideos, setAllVideos] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const fetchVideos = async () => {
      try {
        const data = await apiService.getVideos(1, 200);
        const available = (data.videos || []).filter(
          v => !existingVideoIds.includes(v.videoId)
        );
        setAllVideos(available);
      } catch (err) {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    fetchVideos();
  }, [existingVideoIds]);

  const filtered = filter
    ? allVideos.filter(v =>
        v.videoTitle.toLowerCase().includes(filter.toLowerCase()) ||
        (v.channelName || '').toLowerCase().includes(filter.toLowerCase()))
    : allVideos;

  const toggleSelect = (videoId) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(videoId)) next.delete(videoId);
      else next.add(videoId);
      return next;
    });
  };

  const handleAdd = async () => {
    if (selected.size === 0 || adding) return;
    setAdding(true);
    try {
      await apiService.addBrainVideosBulk(brainId, [...selected]);
      onAdded();
    } catch (err) {
      alert(err.message);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal brain-add-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add Videos to Brain</h2>
        <div className="brain-add-search">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search videos..."
            autoFocus
          />
        </div>

        {loading ? (
          <div className="loading-text">Loading videos...</div>
        ) : filtered.length === 0 ? (
          <div className="brains-empty"><p>No available videos to add.</p></div>
        ) : (
          <div className="brain-add-list">
            {filtered.map(video => (
              <label key={video.videoId} className="brain-add-item">
                <input
                  type="checkbox"
                  checked={selected.has(video.videoId)}
                  onChange={() => toggleSelect(video.videoId)}
                />
                <div className="brain-add-item-thumb">
                  <img
                    src={`https://img.youtube.com/vi/${video.videoId}/mqdefault.jpg`}
                    alt=""
                  />
                </div>
                <div className="brain-add-item-info">
                  <div className="brain-add-item-title">{video.videoTitle}</div>
                  <div className="brain-add-item-channel">{video.channelName}</div>
                </div>
              </label>
            ))}
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-sm btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-sm btn-primary"
            onClick={handleAdd}
            disabled={selected.size === 0 || adding}
          >
            {adding ? 'Adding...' : `Add ${selected.size} Video${selected.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default BrainsPage;
