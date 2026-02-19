import React, { useState } from 'react';

function AddVideoModal({ onClose, onAdd }) {
  const [formData, setFormData] = useState({
    videoUrl: '',
    videoTitle: '',
    channelName: '',
    channelUrl: '',
    channelId: '',
    channelIdSource: 'manual'
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const extractVideoId = (url) => {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
      /^([a-zA-Z0-9_-]{11})$/
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return null;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const videoId = extractVideoId(formData.videoUrl);
    if (!videoId) {
      setError('Invalid YouTube URL');
      return;
    }

    if (!formData.videoTitle.trim()) {
      setError('Video title is required');
      return;
    }

    setLoading(true);
    try {
      const videoData = {
        videoId,
        videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
        videoTitle: formData.videoTitle,
        channelName: formData.channelName || 'Unknown Channel',
        channelUrl: formData.channelUrl || '',
        channelId: formData.channelId || '',
        channelIdSource: formData.channelIdSource,
        scrapedAt: new Date().toISOString()
      };

      await onAdd(videoData);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Add YouTube Video</h2>

        {error && (
          <div className="error-banner" style={{ marginBottom: '16px' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="videoUrl">YouTube URL *</label>
            <input
              type="text"
              id="videoUrl"
              name="videoUrl"
              value={formData.videoUrl}
              onChange={handleChange}
              placeholder="https://www.youtube.com/watch?v=..."
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="videoTitle">Video Title *</label>
            <input
              type="text"
              id="videoTitle"
              name="videoTitle"
              value={formData.videoTitle}
              onChange={handleChange}
              placeholder="Enter video title"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="channelName">Channel Name</label>
            <input
              type="text"
              id="channelName"
              name="channelName"
              value={formData.channelName}
              onChange={handleChange}
              placeholder="Channel name"
            />
          </div>

          <div className="form-group">
            <label htmlFor="channelUrl">Channel URL</label>
            <input
              type="text"
              id="channelUrl"
              name="channelUrl"
              value={formData.channelUrl}
              onChange={handleChange}
              placeholder="https://www.youtube.com/channel/..."
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Adding...' : 'Add Video'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AddVideoModal;
