import React, { useState, useEffect } from 'react';
import { apiService } from '../services/api';

function SettingsPage() {
  const [settings, setSettings] = useState({});
  const [apiKeys, setApiKeys] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const data = await apiService.getSettings();
      setSettings(data.settings || {});
      setApiKeys(data.apiKeys || {});
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setLoading(false);
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

  if (loading) {
    return <div className="loading">Loading settings...</div>;
  }

  const currentProvider = settings.transcription_provider || 'assemblyai';
  const currentModel = settings.gemini_model || 'gemini-2.5-flash';

  return (
    <div className="settings-page">
      <h2>Settings</h2>

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

      {/* Gemini Model */}
      <div className="settings-section">
        <h3>Gemini Model</h3>
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
