import React, { useState, useEffect } from 'react';
import { apiService } from '../services/api';

function TranscriptModal({ videoId, videoTitle, onClose }) {
  const [transcript, setTranscript] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchTranscript = async () => {
      try {
        const data = await apiService.getTranscript(videoId);
        setTranscript(data.transcript);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchTranscript();
  }, [videoId]);

  const handleCopy = async () => {
    if (transcript?.content) {
      await navigator.clipboard.writeText(transcript.content);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal transcript-modal" onClick={(e) => e.stopPropagation()}>
        <div className="transcript-modal-header">
          <h2>Transcript</h2>
          <button className="btn btn-sm btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="transcript-modal-title">{videoTitle}</p>

        {loading ? (
          <div className="transcript-modal-loading">Loading transcript...</div>
        ) : error ? (
          <div className="transcript-modal-error">{error}</div>
        ) : (
          <>
            <div className="transcript-modal-actions">
              <button className="btn btn-sm btn-secondary" onClick={handleCopy}>
                Copy to Clipboard
              </button>
            </div>
            <div className="transcript-modal-content">
              {transcript.content}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default TranscriptModal;
