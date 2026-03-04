const API_BASE = '/api';

class ApiService {
  async getVideos(page = 1, perPage = 20) {
    const response = await fetch(`${API_BASE}/videos?page=${page}&per_page=${perPage}`);
    if (!response.ok) {
      throw new Error('Failed to fetch videos');
    }
    return response.json();
  }

  async addVideo(videoData) {
    const response = await fetch(`${API_BASE}/videos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(videoData),
    });
    if (!response.ok) {
      throw new Error('Failed to add video');
    }
    return response.json();
  }

  async deleteVideo(videoId) {
    const response = await fetch(`${API_BASE}/videos/${videoId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw new Error('Failed to delete video');
    }
    return response.json();
  }

  async getChromeBookmarks() {
    const response = await fetch(`${API_BASE}/bookmarks/chrome`);
    if (!response.ok) {
      throw new Error('Failed to fetch Chrome bookmarks');
    }
    return response.json();
  }

  async searchTranscripts(query) {
    const response = await fetch(`${API_BASE}/transcripts/search?q=${encodeURIComponent(query)}`);
    if (!response.ok) {
      throw new Error('Failed to search transcripts');
    }
    return response.json();
  }

  async indexTranscript(videoId) {
    const response = await fetch(`${API_BASE}/transcripts/index`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ videoId }),
    });
    if (!response.ok) {
      throw new Error('Failed to index transcript');
    }
    return response.json();
  }

  async getTranscript(videoId) {
    const response = await fetch(`${API_BASE}/transcripts/${videoId}`);
    if (!response.ok) {
      throw new Error('Failed to fetch transcript');
    }
    return response.json();
  }

  async deleteTranscript(videoId) {
    const response = await fetch(`${API_BASE}/transcripts/${videoId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to delete transcript');
    }
    return response.json();
  }

  async startTranscription(videoId) {
    const response = await fetch(`${API_BASE}/transcribe/${videoId}`, {
      method: 'POST',
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to start transcription');
    }
    return response.json();
  }

  async retranscribe(videoId) {
    const response = await fetch(`${API_BASE}/retranscribe/${videoId}`, {
      method: 'POST',
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to start retranscription');
    }
    return response.json();
  }

  async getJobStatus(jobId) {
    const response = await fetch(`${API_BASE}/jobs/${jobId}`);
    if (!response.ok) {
      throw new Error('Failed to get job status');
    }
    return response.json();
  }

  // Health check to see if Docker server is running
  async healthCheck() {
    const response = await fetch(`${API_BASE}/health`);
    return response.ok;
  }

  // Chat with knowledge base via SSE streaming
  async chatStream(message, history, onChunk, onDone, onError) {
    try {
      const response = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Chat request failed');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.error) {
                onError(data.error);
                return;
              }
              if (data.done) {
                onDone();
                return;
              }
              if (data.text) {
                onChunk(data.text);
              }
            } catch (e) {
              // Skip malformed JSON
            }
          }
        }
      }
      onDone();
    } catch (err) {
      onError(err.message);
    }
  }

  // Generate summary for a single video
  async generateSummary(videoId, summaryType = 'structured') {
    const response = await fetch(`${API_BASE}/summaries/${videoId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summaryType }),
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to generate summary');
    }
    return response.json();
  }

  // Get summary for a video
  async getSummary(videoId) {
    const response = await fetch(`${API_BASE}/summaries/${videoId}`);
    if (!response.ok) {
      throw new Error('Failed to fetch summary');
    }
    return response.json();
  }

  // Bulk generate summaries for all transcripts without one
  async generateBulkSummaries() {
    const response = await fetch(`${API_BASE}/summaries/bulk`, {
      method: 'POST',
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to generate bulk summaries');
    }
    return response.json();
  }

  // Get application settings
  async getSettings() {
    const response = await fetch(`${API_BASE}/settings`);
    if (!response.ok) {
      throw new Error('Failed to fetch settings');
    }
    return response.json();
  }

  // Update application settings
  async updateSettings(settings) {
    const response = await fetch(`${API_BASE}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to update settings');
    }
    return response.json();
  }

  // Get application statistics
  async getStats() {
    const response = await fetch(`${API_BASE}/stats`);
    if (!response.ok) {
      throw new Error('Failed to fetch stats');
    }
    return response.json();
  }

  // Semantic search across transcripts
  async semanticSearch(query, k = 20) {
    const response = await fetch(
      `${API_BASE}/search?q=${encodeURIComponent(query)}&k=${k}`
    );
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Search failed');
    }
    return response.json();
  }

  // Build embeddings for all unembedded transcripts
  async buildEmbeddings() {
    const response = await fetch(`${API_BASE}/embeddings/build`, {
      method: 'POST',
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to build embeddings');
    }
    return response.json();
  }

  // Rebuild all embeddings (clear and re-embed)
  async rebuildEmbeddings() {
    const response = await fetch(`${API_BASE}/embeddings/rebuild`, {
      method: 'POST',
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to rebuild embeddings');
    }
    return response.json();
  }

  // Get embedding status
  async getEmbeddingStatus() {
    const response = await fetch(`${API_BASE}/embeddings/status`);
    if (!response.ok) {
      throw new Error('Failed to fetch embedding status');
    }
    return response.json();
  }

  // Brain endpoints

  async getBrains() {
    const response = await fetch(`${API_BASE}/brains`);
    if (!response.ok) throw new Error('Failed to fetch brains');
    return response.json();
  }

  async createBrain(name, description = '') {
    const response = await fetch(`${API_BASE}/brains`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description }),
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to create brain');
    }
    return response.json();
  }

  async getBrain(brainId) {
    const response = await fetch(`${API_BASE}/brains/${brainId}`);
    if (!response.ok) throw new Error('Failed to fetch brain');
    return response.json();
  }

  async updateBrain(brainId, updates) {
    const response = await fetch(`${API_BASE}/brains/${brainId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to update brain');
    }
    return response.json();
  }

  async deleteBrain(brainId) {
    const response = await fetch(`${API_BASE}/brains/${brainId}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete brain');
    return response.json();
  }

  async addBrainVideo(brainId, videoId) {
    const response = await fetch(`${API_BASE}/brains/${brainId}/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId }),
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to add video to brain');
    }
    return response.json();
  }

  async removeBrainVideo(brainId, videoId) {
    const response = await fetch(`${API_BASE}/brains/${brainId}/videos/${videoId}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to remove video from brain');
    return response.json();
  }

  async addBrainVideosBulk(brainId, videoIds) {
    const response = await fetch(`${API_BASE}/brains/${brainId}/videos/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoIds }),
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to add videos to brain');
    }
    return response.json();
  }

  async brainChatStream(brainId, message, history, onChunk, onDone, onError) {
    try {
      const response = await fetch(`${API_BASE}/brains/${brainId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Chat request failed');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.error) { onError(data.error); return; }
              if (data.done) { onDone(); return; }
              if (data.text) onChunk(data.text);
            } catch (e) { /* skip */ }
          }
        }
      }
      onDone();
    } catch (err) {
      onError(err.message);
    }
  }

  async suggestBrains(videoId) {
    const response = await fetch(`${API_BASE}/brains/suggest/${videoId}`);
    if (!response.ok) throw new Error('Failed to get brain suggestions');
    return response.json();
  }
}

export const apiService = new ApiService();
