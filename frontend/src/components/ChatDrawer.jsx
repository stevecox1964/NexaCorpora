import React, { useState, useRef, useEffect } from 'react';
import { apiService } from '../services/api';

function ChatDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

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
          <button className="btn btn-sm btn-secondary" onClick={handleClear} disabled={isStreaming}>
            Clear
          </button>
          <button className="btn btn-sm btn-secondary" onClick={() => setIsOpen(false)}>
            Minimize
          </button>
        </div>
      </div>
      <div className="chat-drawer-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            Ask a question about your transcribed videos...
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`chat-message chat-message-${msg.role}`}>
            <div className="chat-message-content">
              {msg.content || (isStreaming && i === messages.length - 1 ? '...' : '')}
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
