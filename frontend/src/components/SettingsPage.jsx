import React, { useState, useEffect } from 'react';
import { apiService } from '../services/api';

function SettingsPage() {
  const [settings, setSettings] = useState({});
  const [apiKeys, setApiKeys] = useState({});
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingField, setEditingField] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [embeddingStatus, setEmbeddingStatus] = useState(null);
  const [buildingEmbeddings, setBuildingEmbeddings] = useState(false);
  const [rebuildingEmbeddings, setRebuildingEmbeddings] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [settingsData, statsData, embData] = await Promise.all([
        apiService.getSettings(),
        apiService.getStats(),
        apiService.getEmbeddingStatus().catch(() => null),
      ]);
      setSettings(settingsData.settings || {});
      setApiKeys(settingsData.apiKeys || {});
      setStats(statsData);
      if (embData) setEmbeddingStatus(embData);
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleBuildEmbeddings = async () => {
    setBuildingEmbeddings(true);
    try {
      const result = await apiService.buildEmbeddings();
      alert(`Embedded ${result.embedded} video${result.embedded !== 1 ? 's' : ''}.${result.errors?.length ? ` ${result.errors.length} error(s).` : ''}`);
      const embData = await apiService.getEmbeddingStatus().catch(() => null);
      if (embData) setEmbeddingStatus(embData);
    } catch (err) {
      alert(`Embedding failed: ${err.message}`);
    } finally {
      setBuildingEmbeddings(false);
    }
  };

  const handleRebuildEmbeddings = async () => {
    if (!confirm('This will clear all existing embeddings and re-embed every transcript. Continue?')) return;
    setRebuildingEmbeddings(true);
    try {
      const result = await apiService.rebuildEmbeddings();
      alert(`Rebuilt embeddings for ${result.embedded} video${result.embedded !== 1 ? 's' : ''}.${result.errors?.length ? ` ${result.errors.length} error(s).` : ''}`);
      const embData = await apiService.getEmbeddingStatus().catch(() => null);
      if (embData) setEmbeddingStatus(embData);
    } catch (err) {
      alert(`Rebuild failed: ${err.message}`);
    } finally {
      setRebuildingEmbeddings(false);
    }
  };

  const handleUpdate = async (key, value) => {
    setSaving(true);
    try {
      const data = await apiService.updateSettings({ [key]: value });
      setSettings(data.settings || {});
    } catch (err) {
      console.error('Failed to update setting:', err);
    } finally {
      setSaving(false);
    }
  };

  const startEditing = (field) => {
    setEditingField(field);
    setEditValue(settings[field] || '');
  };

  const saveEditing = () => {
    if (editValue.trim() && editValue.trim() !== settings[editingField]) {
      handleUpdate(editingField, editValue.trim());
    }
    setEditingField(null);
  };

  const handleEditKeyDown = (e) => {
    if (e.key === 'Enter') saveEditing();
    if (e.key === 'Escape') setEditingField(null);
  };

  if (loading) {
    return <div className="loading">Loading settings...</div>;
  }

  const profileName = settings.profile_name || 'BookMarkManager User';
  const profileSubtitle = settings.profile_subtitle || 'YouTube Bookmark Collection';
  const currentProvider = settings.transcription_provider || 'assemblyai';
  const currentModel = settings.gemini_model || 'gemini-2.5-flash';

  return (
    <div className="settings-page">
      <h2>Settings</h2>

      {/* Profile Section */}
      <div className="settings-section">
        <h3>Profile</h3>
        <div className="profile-row">
          <div className="profile-avatar">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#3ea6ff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <div className="profile-details">
            <div className="profile-field">
              {editingField === 'profile_name' ? (
                <input
                  className="profile-edit-input"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={saveEditing}
                  onKeyDown={handleEditKeyDown}
                  maxLength={100}
                  autoFocus
                />
              ) : (
                <span
                  className="profile-name-editable"
                  onClick={() => startEditing('profile_name')}
                  title="Click to edit"
                >
                  {profileName}
                  <svg className="edit-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </span>
              )}
            </div>
            <div className="profile-field">
              {editingField === 'profile_subtitle' ? (
                <input
                  className="profile-edit-input profile-edit-subtitle"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={saveEditing}
                  onKeyDown={handleEditKeyDown}
                  maxLength={100}
                  autoFocus
                />
              ) : (
                <span
                  className="profile-subtitle-editable"
                  onClick={() => startEditing('profile_subtitle')}
                  title="Click to edit"
                >
                  {profileSubtitle}
                  <svg className="edit-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </span>
              )}
            </div>
          </div>
          {stats && (
            <div className="profile-stats">
              <div className="profile-stat">
                <span className="profile-stat-value">{stats.totalVideos}</span>
                <span className="profile-stat-label">Videos</span>
              </div>
              <div className="profile-stat">
                <span className="profile-stat-value">{stats.totalTranscripts}</span>
                <span className="profile-stat-label">Transcripts</span>
              </div>
              <div className="profile-stat">
                <span className="profile-stat-value">{stats.totalSummaries}</span>
                <span className="profile-stat-label">Summaries</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Gemini Model */}
      <div className="settings-section">
        <h3>Model Configuration</h3>
        <p className="settings-description">
          Select the Gemini model used for chat, summaries, and Gemini audio transcription.
        </p>
        <select
          className="settings-select"
          value={currentModel}
          onChange={(e) => handleUpdate('gemini_model', e.target.value)}
          disabled={saving}
        >
          <option value="gemini-2.5-flash">gemini-2.5-flash (recommended)</option>
          <option value="gemini-3-flash-preview">gemini-3-flash-preview (newest, preview)</option>
          <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite (cheapest)</option>
        </select>
      </div>

      {/* Transcription Provider */}
      <div className="settings-section">
        <h3>Transcription Provider</h3>
        <p className="settings-description">
          Choose which service to use for transcribing YouTube video audio.
        </p>

        <div
          className={`provider-card ${currentProvider === 'assemblyai' ? 'selected' : ''}`}
          onClick={() => handleUpdate('transcription_provider', 'assemblyai')}
        >
          <div className="provider-radio">
            <div className={`radio-dot ${currentProvider === 'assemblyai' ? 'active' : ''}`} />
          </div>
          <div className="provider-info">
            <div className="provider-name">AssemblyAI</div>
            <div className="provider-desc">
              Dedicated speech-to-text API. High accuracy, speaker detection support.
            </div>
            <div className="provider-status">
              <span className={`api-status-dot ${apiKeys.assemblyai ? 'configured' : 'missing'}`} />
              <span>{apiKeys.assemblyai ? 'API key configured' : 'API key not configured'}</span>
            </div>
          </div>
        </div>

        <div
          className={`provider-card ${currentProvider === 'gemini' ? 'selected' : ''}`}
          onClick={() => handleUpdate('transcription_provider', 'gemini')}
        >
          <div className="provider-radio">
            <div className={`radio-dot ${currentProvider === 'gemini' ? 'active' : ''}`} />
          </div>
          <div className="provider-info">
            <div className="provider-name">Gemini Audio</div>
            <div className="provider-desc">
              Uses Google Gemini multimodal model to transcribe audio. Uses existing Google API key.
            </div>
            <div className="provider-status">
              <span className={`api-status-dot ${apiKeys.google ? 'configured' : 'missing'}`} />
              <span>{apiKeys.google ? 'API key configured' : 'API key not configured'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Embeddings */}
      <div className="settings-section">
        <h3>Vector Embeddings</h3>
        <p className="settings-description">
          Embeddings power semantic search and topic clustering. Build embeddings for all transcripts that don't have them yet.
        </p>
        {embeddingStatus && (
          <div className="embedding-stats">
            <div className="embedding-stat">
              <span className="embedding-stat-value">{embeddingStatus.embeddedVideos}</span>
              <span className="embedding-stat-label">Embedded</span>
            </div>
            <div className="embedding-stat">
              <span className="embedding-stat-value">{embeddingStatus.unembeddedVideos}</span>
              <span className="embedding-stat-label">Pending</span>
            </div>
            <div className="embedding-stat">
              <span className="embedding-stat-value">{embeddingStatus.totalChunks}</span>
              <span className="embedding-stat-label">Chunks</span>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          <button
            className="btn btn-primary"
            onClick={handleBuildEmbeddings}
            disabled={buildingEmbeddings || rebuildingEmbeddings || (embeddingStatus && embeddingStatus.unembeddedVideos === 0)}
          >
            {buildingEmbeddings ? 'Building...' : embeddingStatus && embeddingStatus.unembeddedVideos === 0 ? 'All Embedded' : 'Build Embeddings'}
          </button>
          <button
            className="btn btn-secondary"
            onClick={handleRebuildEmbeddings}
            disabled={buildingEmbeddings || rebuildingEmbeddings || !embeddingStatus || embeddingStatus.totalChunks === 0}
          >
            {rebuildingEmbeddings ? 'Rebuilding...' : 'Rebuild All'}
          </button>
        </div>
        {(buildingEmbeddings || rebuildingEmbeddings) && (
          <div className="embedding-building-hint">
            <div className="spinner" /> {rebuildingEmbeddings ? 'Rebuilding all embeddings via Gemini...' : 'Generating embeddings via Gemini...'}
          </div>
        )}
      </div>

      {/* API Key Status */}
      <div className="settings-section">
        <h3>API Key Status</h3>
        <div className="api-status-list">
          <div className="api-status-row">
            <span className={`api-status-dot ${apiKeys.assemblyai ? 'configured' : 'missing'}`} />
            <span className="api-status-label">AssemblyAI API Key</span>
            <span className="api-status-value">
              {apiKeys.assemblyai ? 'Configured' : 'Not configured'}
            </span>
          </div>
          <div className="api-status-row">
            <span className={`api-status-dot ${apiKeys.google ? 'configured' : 'missing'}`} />
            <span className="api-status-label">Google API Key</span>
            <span className="api-status-value">
              {apiKeys.google ? 'Configured' : 'Not configured'}
            </span>
          </div>
          <div className="api-status-row">
            <span className="api-status-dot configured" />
            <span className="api-status-label">Active Gemini Model</span>
            <span className="api-status-value">{currentModel}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsPage;
