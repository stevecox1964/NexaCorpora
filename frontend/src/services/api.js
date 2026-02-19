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
}

export const apiService = new ApiService();
