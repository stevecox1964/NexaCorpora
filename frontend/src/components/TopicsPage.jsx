import React, { useState, useEffect } from 'react';
import { apiService } from '../services/api';

function TopicsPage() {
  const [clusters, setClusters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState(null);
  const [selectedCluster, setSelectedCluster] = useState(null);
  const [clusterVideos, setClusterVideos] = useState([]);
  const [loadingVideos, setLoadingVideos] = useState(false);

  useEffect(() => {
    loadClusters();
  }, []);

  const loadClusters = async () => {
    try {
      const data = await apiService.getClusters();
      setClusters(data.clusters || []);
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
      const data = await apiService.buildClusters();
      setClusters(data.clusters || []);
      setSelectedCluster(null);
      setClusterVideos([]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBuilding(false);
    }
  };

  const handleSelectCluster = async (cluster) => {
    if (selectedCluster?.clusterId === cluster.clusterId) {
      setSelectedCluster(null);
      setClusterVideos([]);
      return;
    }

    setSelectedCluster(cluster);
    setLoadingVideos(true);
    try {
      const data = await apiService.getClusterVideos(cluster.clusterId);
      setClusterVideos(data.videos || []);
    } catch (err) {
      setError(err.message);
      setClusterVideos([]);
    } finally {
      setLoadingVideos(false);
    }
  };

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
          <button
            className="btn btn-secondary"
            onClick={() => setError(null)}
            style={{ marginLeft: 'auto' }}
          >
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
        <>
          <div className="topics-grid">
            {clusters.map(cluster => (
              <div
                key={cluster.clusterId}
                className={`topic-card ${selectedCluster?.clusterId === cluster.clusterId ? 'selected' : ''}`}
                onClick={() => handleSelectCluster(cluster)}
              >
                <div className="topic-card-thumbnails">
                  {(cluster.thumbnailVideoIds || []).slice(0, 4).map(vid => (
                    <img
                      key={vid}
                      src={`https://img.youtube.com/vi/${vid}/mqdefault.jpg`}
                      alt=""
                    />
                  ))}
                  {(!cluster.thumbnailVideoIds || cluster.thumbnailVideoIds.length === 0) && (
                    <div className="topic-card-placeholder">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="1.5">
                        <rect x="2" y="3" width="20" height="14" rx="2" />
                        <polygon points="10 8 16 12 10 16" fill="#555" stroke="none" />
                      </svg>
                    </div>
                  )}
                </div>
                <div className="topic-card-info">
                  <div className="topic-card-label">{cluster.label}</div>
                  <div className="topic-card-count">{cluster.videoCount} video{cluster.videoCount !== 1 ? 's' : ''}</div>
                </div>
              </div>
            ))}
          </div>

          {selectedCluster && (
            <div className="topic-videos-section">
              <h3>{selectedCluster.label}</h3>
              {loadingVideos ? (
                <div className="loading">Loading videos...</div>
              ) : (
                <div className="topic-videos-list">
                  {clusterVideos.map(video => (
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
                      <div className="topic-video-badges">
                        {video.hasTranscript && (
                          <span className="badge badge-green">Transcript</span>
                        )}
                        {video.hasSummary && (
                          <span className="badge badge-blue">Summary</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default TopicsPage;
