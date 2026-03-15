import React, { useState, useRef, useEffect, useCallback } from 'react';
import { apiService } from '../services/api';
import { renderChatContent } from '../utils/chatUtils';
import { saveToFile } from '../utils/saveToFile';

function ChatDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [playerVideoId, setPlayerVideoId] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const playerRef = useRef(null);
  const apiLoadedRef = useRef(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Load YouTube IFrame API
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

  // Clean up player on unmount
  useEffect(() => {
    return () => {
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch (e) { /* ignore */ }
        playerRef.current = null;
      }
    };
  }, []);

  const createOrSeekPlayer = useCallback((seconds, videoId) => {
    // If player exists and same video, just seek
    if (playerRef.current && playerVideoId === videoId) {
      playerRef.current.seekTo(seconds, true);
      playerRef.current.playVideo();
      return;
    }

    // If player exists but different video, destroy it first
    if (playerRef.current) {
      try { playerRef.current.destroy(); } catch (e) { /* ignore */ }
      playerRef.current = null;
    }

    setPlayerVideoId(videoId);

    if (!apiLoadedRef.current && !(window.YT && window.YT.Player)) {
      // API not ready yet — will be created when container renders
      return;
    }

    apiLoadedRef.current = true;

    setTimeout(() => {
      const container = document.getElementById('yt-player-chat');
      if (!container) return;

      playerRef.current = new window.YT.Player('yt-player-chat', {
        videoId: videoId,
        playerVars: {
          autoplay: 1,
          start: seconds,
          modestbranding: 1,
          rel: 0,
        },
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
      try { playerRef.current.destroy(); } catch (e) { /* ignore */ }
      playerRef.current = null;
    }
    setPlayerVideoId(null);
  }, []);

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || isStreaming) return;

    const userMessage = { role: 'user', content: text };
    const history = [...messages];

    setMessages(prev => [...prev, userMessage, { role: 'assistant', content: '' }]);
    setInputText('');
    setIsStreaming(true);

    await apiService.chatStream(
      text,
      history,
      (chunk) => {
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          updated[updated.length - 1] = { ...last, content: last.content + chunk };
          return updated;
        });
      },
      () => {
        setIsStreaming(false);
      },
      (error) => {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: `Error: ${error}` };
          return updated;
        });
        setIsStreaming(false);
      }
    );
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    setMessages([]);
    closePlayer();
  };

  if (!isOpen) {
    return (
      <button className="chat-fab" onClick={() => setIsOpen(true)} title="Chat with Knowledge Base">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>
    );
  }

  return (
    <div className="chat-drawer">
      <div className="chat-drawer-header">
        <span className="chat-drawer-title">Chat with Knowledge Base</span>
        <div className="chat-drawer-header-actions">
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => {
              const text = messages.map(m => `[${m.role === 'user' ? 'You' : 'Assistant'}]\n${m.content}`).join('\n\n');
              saveToFile(text, 'chat');
            }}
            disabled={isStreaming || messages.length === 0}
            title="Save chat to file"
          >
            Save
          </button>
          <button className="btn btn-sm btn-secondary" onClick={handleClear} disabled={isStreaming}>
            Clear
          </button>
          <button className="btn btn-sm btn-secondary" onClick={() => setIsOpen(false)}>
            Minimize
          </button>
        </div>
      </div>

      {playerVideoId && (
        <div className="chat-player-wrapper">
          <div id="yt-player-chat"></div>
          <button className="chat-player-close" onClick={closePlayer} title="Close player">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      <div className="chat-drawer-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            Ask a question about your transcribed videos...
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`chat-message chat-message-${msg.role}`}>
            <div className="chat-message-content">
              {msg.role === 'assistant' && msg.content
                ? renderChatContent(msg.content, handleTimestampClick)
                : msg.content || (isStreaming && i === messages.length - 1 ? '...' : '')}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div className="chat-drawer-input">
        <input
          ref={inputRef}
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your videos..."
          disabled={isStreaming}
        />
        <button
          className="btn btn-primary btn-sm"
          onClick={handleSend}
          disabled={isStreaming || !inputText.trim()}
        >
          {isStreaming ? '...' : 'Send'}
        </button>
      </div>
    </div>
  );
}

export default ChatDrawer;
