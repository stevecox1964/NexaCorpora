import os
import logging
from google import genai
from google.genai import types
from .models import Transcript, Video, Setting

logger = logging.getLogger(__name__)


def _get_client():
    """Create and return a Gemini client."""
    api_key = os.environ.get('GOOGLE_API_KEY')
    if not api_key:
        raise ValueError('GOOGLE_API_KEY not configured')
    return genai.Client(api_key=api_key)


def _get_model_name():
    """Model from the settings table, falling back to the env default."""
    try:
        model = Setting.get('gemini_model')
    except Exception:
        model = None
    return model or os.environ.get('GEMINI_MODEL', 'gemini-2.5-flash')


def _source_info(video, video_id):
    """(url, human label) for the prompt — web pages have their own URL and no timestamps."""
    if video and video.get('type') == 'web':
        return video.get('videoUrl') or '', 'web page'
    return f"https://www.youtube.com/watch?v={video_id}", 'YouTube video transcript'


def generate_summary(video_id):
    """Generate a short 2-4 sentence narrative summary for a video's transcript."""
    transcript = Transcript.get_by_video_id(video_id)
    if not transcript:
        return None, 'Transcript not found'
    if not transcript.get('content'):
        return None, 'Transcript has no content'

    video = Video.get_by_video_id(video_id)
    video_title = video['videoTitle'] if video else 'Unknown'
    video_url, source_kind = _source_info(video, video_id)

    client = _get_client()

    prompt = (
        f"Summarize the following {source_kind} in 2-4 concise sentences. "
        "Cover the main topic, key points, and conclusion. Be brief and direct.\n\n"
        f"Title: {video_title}\n"
        f"URL: {video_url}\n\n"
        f"Content:\n{transcript['content']}"
    )

    response = client.models.generate_content(model=_get_model_name(), contents=prompt)
    updated = Transcript.update_summary(video_id, response.text)
    return updated, None


def generate_faq(video_id):
    """Generate FAQ Q&A pairs from a video's transcript."""
    transcript = Transcript.get_by_video_id(video_id)
    if not transcript:
        return None, 'Transcript not found'
    if not transcript.get('content'):
        return None, 'Transcript has no content'

    video = Video.get_by_video_id(video_id)
    video_title = video['videoTitle'] if video else 'Unknown'
    video_url, source_kind = _source_info(video, video_id)

    client = _get_client()

    prompt = (
        f"Extract frequently asked questions and their answers from the following {source_kind}. "
        "Identify the key questions that a reader might have after reading this, and provide clear, "
        "concise answers based on the content.\n\n"
        "Return the response in this format:\n\n"
        f"Source: {video_title}\n"
        f"{video_url}\n\n"
        "## Frequently Asked Questions\n\n"
        "**Q: [Question]?**\n"
        "A: [Answer]\n\n"
        "Generate 5-10 Q&A pairs covering the most important topics discussed. "
        "If the video covers technical content, include technical questions. "
        "Keep answers factual and based only on what was discussed in the transcript.\n\n"
        f"Video Title: {video_title}\n"
        f"Video URL: {video_url}\n\n"
        f"Transcript:\n{transcript['content']}"
    )

    response = client.models.generate_content(model=_get_model_name(), contents=prompt)
    updated = Transcript.update_faq(video_id, response.text)
    return updated, None


def chat_with_knowledge_base(user_message, conversation_history=None):
    """Generator that yields text chunks for SSE streaming.

    Uses vector similarity search for context retrieval, falling back to
    summaries when no embeddings exist.
    """
    context = None

    # Primary: vector similarity search over transcript chunks
    try:
        from .embedding_service import search_similar
        results = search_similar(user_message, k=8)
        if results:
            context_parts = []
            for r in results:
                title = r.get('video_title', 'Unknown')
                video_id = r.get('video_id', '')
                content = r.get('content', '')
                label = 'Page' if r.get('type') == 'web' else 'Video'
                context_parts.append(f"=== {label}: {title} (videoId: {video_id}) ===\n{content}")
            context = "\n\n".join(context_parts)
    except Exception:
        pass

    # Fallback: summaries when vector search returns nothing or fails
    if not context:
        summaries = Transcript.get_all_summaries()
        if summaries:
            context_parts = []
            for s in summaries:
                parts = [f"Video: {s['video_title']} (videoId: {s['video_id']}, by {s['channel_name']})"]
                if s.get('summary'):
                    parts.append(f"Summary: {s['summary']}")
                if s.get('faq'):
                    parts.append(f"FAQ: {s['faq']}")
                context_parts.append("\n".join(parts))
            context = "\n\n".join(context_parts)
        else:
            context = "No transcripts are available in the knowledge base yet."

    system_prompt = (
        "You are a helpful assistant that answers questions based on a knowledge base "
        "of YouTube video transcripts and saved web pages. Use the following context to answer "
        "the user's question. If the context doesn't contain relevant information, say so "
        "honestly. Always mention which video(s) your answer is based on when applicable.\n\n"
        "IMPORTANT: When citing specific timestamps from a video, use this exact format: "
        "[M:SS](videoId) — for example [7:11](dQw4w9WgXcQ). This allows the user to click "
        "the timestamp to jump to that moment in the video. Always use the videoId provided "
        "in the context header for each video. For timestamp ranges, format each timestamp "
        "separately, e.g. [7:11](abc123) to [8:07](abc123). "
        "Sources whose header starts with 'Page:' are web pages, not videos — they have "
        "no timestamps, so cite them by title only.\n\n"
        f"Knowledge Base Context:\n{context}"
    )

    client = _get_client()

    # Build message history
    messages = []
    if conversation_history:
        for msg in conversation_history:
            role = 'user' if msg['role'] == 'user' else 'model'
            messages.append(types.Content(role=role, parts=[types.Part.from_text(text=msg['content'])]))

    messages.append(types.Content(role='user', parts=[types.Part.from_text(text=user_message)]))

    # Stream the response
    for chunk in client.models.generate_content_stream(
        model=_get_model_name(),
        contents=messages,
        config=types.GenerateContentConfig(system_instruction=system_prompt),
    ):
        if chunk.text:
            yield chunk.text


# Model listing — fetched live from Google, cached in memory

_MODEL_CACHE = {'models': None, 'fetched_at': 0}
_MODEL_CACHE_TTL = 3600  # seconds

# Substrings that mark a model as not usable for chat/summaries/transcription
_MODEL_EXCLUDE = (
    'image', 'banana', 'tts', 'audio', 'live', 'robotics', 'computer-use',
    'embedding', 'veo', 'lyria', 'deep-research', 'antigravity', 'customtools',
)


def list_available_models(force_refresh=False):
    """Return chat-capable Gemini model ids from the Google API.

    Cached for an hour. Raises on API failure so the caller can fall back.
    """
    import time
    now = time.time()
    if (not force_refresh and _MODEL_CACHE['models']
            and now - _MODEL_CACHE['fetched_at'] < _MODEL_CACHE_TTL):
        return _MODEL_CACHE['models']

    client = _get_client()
    models = []
    for m in client.models.list():
        name = m.name.replace('models/', '')
        if not name.startswith('gemini-'):
            continue
        if 'generateContent' not in (m.supported_actions or []):
            continue
        if any(bad in name for bad in _MODEL_EXCLUDE):
            continue
        models.append({'id': name, 'label': m.display_name or name})

    models.sort(key=lambda x: x['id'])
    _MODEL_CACHE['models'] = models
    _MODEL_CACHE['fetched_at'] = now
    return models
