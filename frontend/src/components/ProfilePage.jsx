import React, { useState, useEffect } from 'react';
import { apiService } from '../services/api';

function ProfilePage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const data = await apiService.getStats();
      setStats(data);
    } catch (err) {
      console.error('Failed to load stats:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading profile...</div>;
  }

  return (
    <div className="profile-page">
      <h2>Profile</h2>

      <div className="profile-card">
        <div className="profile-avatar">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#3ea6ff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
        <div className="profile-name">BookMarkManager User</div>
        <div className="profile-subtitle">YouTube Bookmark Collection</div>
      </div>

      <h3 className="stats-heading">Collection Statistics</h3>

      {stats && (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-card-value">{stats.totalVideos}</div>
            <div className="stat-card-label">Videos Saved</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-value">{stats.totalTranscripts}</div>
            <div className="stat-card-label">Transcripts</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-value">{stats.totalSummaries}</div>
            <div className="stat-card-label">Summaries</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProfilePage;
