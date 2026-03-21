import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiService } from '../services/api';

const STEPS = {
  process: [
    { key: 'downloading', label: 'Downloading Audio' },
    { key: 'transcribing', label: 'Transcribing' },
    { key: 'summarizing', label: 'Generating Summary & FAQ' },
  ],
  refresh: [
    { key: 'summarizing', label: 'Generating Summary & FAQ' },
  ],
};

// Map job status to which step index is active
const STATUS_TO_STEP = {
  pending: 0,
  downloading: 0,
  transcribing: 1,
  summarizing: 2,
  completed: 3,
  failed: -1,
};

function ProcessModal({ videoId, videoTitle, mode, onComplete, onClose }) {
  const [currentStatus, setCurrentStatus] = useState(mode === 'refresh' ? 'summarizing' : 'pending');
  const [error, setError] = useState(null);
  const [jobId, setJobId] = useState(null);
  const pollRef = useRef(null);
  const startedRef = useRef(false);

  const steps = STEPS[mode] || STEPS.process;

  const cleanup = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Start the job
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    if (mode === 'refresh') {
      // Refresh is a single synchronous API call (no job polling)
      setCurrentStatus('summarizing');
      apiService.refreshSummaryFaq(videoId)
        .then((data) => {
          setCurrentStatus('completed');
          onComplete(videoId, data);
        })
        .catch((err) => {
          setCurrentStatus('failed');
          setError(err.message);
        });
    } else {
      // Process: start transcription job + poll
      apiService.startTranscription(videoId)
        .then((data) => {
          const id = data.job.id;
          setJobId(id);
          setCurrentStatus('pending');

          pollRef.current = setInterval(async () => {
            try {
              const statusData = await apiService.getJobStatus(id);
              const job = statusData.job;

              if (!job) {
                cleanup();
                setCurrentStatus('failed');
                setError('Job disappeared unexpectedly');
                return;
              }

              setCurrentStatus(job.status);

              if (job.status === 'completed') {
                cleanup();
                onComplete(videoId, null);
              } else if (job.status === 'failed') {
                cleanup();
                setError(job.errorMessage || 'Unknown error');
              }
            } catch (err) {
              cleanup();
              setCurrentStatus('failed');
              setError(err.message);
            }
          }, 4000);
        })
        .catch((err) => {
          setCurrentStatus('failed');
          setError(err.message);
        });
    }

    return cleanup;
  }, [videoId, mode, onComplete, cleanup]);

  const isCompleted = currentStatus === 'completed';
  const isFailed = currentStatus === 'failed';
  const isDone = isCompleted || isFailed;

  // Determine step states
  const getStepState = (stepIndex) => {
    if (isFailed) {
      // For process mode, figure out which step failed
      const activeStepIndex = mode === 'refresh' ? 0 : getActiveStepIndex();
      if (stepIndex < activeStepIndex) return 'completed';
      if (stepIndex === activeStepIndex) return 'failed';
      return 'pending';
    }
    if (isCompleted) return 'completed';

    const activeStepIndex = getActiveStepIndex();
    if (stepIndex < activeStepIndex) return 'completed';
    if (stepIndex === activeStepIndex) return 'active';
    return 'pending';
  };

  const getActiveStepIndex = () => {
    if (mode === 'refresh') return 0;
    const mapped = STATUS_TO_STEP[currentStatus];
    return mapped !== undefined ? mapped : 0;
  };

  const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;

  return (
    <div className="modal-overlay" onClick={(e) => { if (isDone && e.target === e.currentTarget) onClose(); }}>
      <div className="modal process-modal">
        {/* Header */}
        <div className="process-modal-header">
          <h2>{mode === 'refresh' ? 'Refreshing Summary & FAQ' : 'Processing Video'}</h2>
          {isDone && (
            <button className="btn btn-sm btn-icon process-modal-close" onClick={onClose} title="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        {/* Video info */}
        <div className="process-modal-video">
          <img src={thumbnailUrl} alt={videoTitle} className="process-modal-thumb" />
          <span className="process-modal-title">{videoTitle}</span>
        </div>

        {/* Steps */}
        <div className="process-modal-steps">
          {steps.map((step, idx) => {
            const state = getStepState(idx);
            return (
              <div key={step.key} className={`process-step process-step-${state}`}>
                <div className="process-step-icon">
                  {state === 'completed' && (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4caf50" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                  {state === 'active' && <span className="spinner process-spinner" />}
                  {state === 'pending' && <span className="process-step-dot" />}
                  {state === 'failed' && (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f44336" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  )}
                </div>
                <span className="process-step-label">{step.label}</span>
              </div>
            );
          })}
        </div>

        {/* Status message */}
        {isCompleted && (
          <div className="process-modal-status process-modal-success">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>{mode === 'refresh' ? 'Summary & FAQ refreshed successfully!' : 'Processing complete!'}</span>
          </div>
        )}

        {isFailed && (
          <div className="process-modal-status process-modal-error">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{error || 'An error occurred'}</span>
          </div>
        )}

        {/* Close button */}
        {isDone && (
          <div className="process-modal-actions">
            <button className="btn btn-primary" onClick={onClose}>
              {isCompleted ? 'Done' : 'Close'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default ProcessModal;
