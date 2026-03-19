import os
import logging
import google.generativeai as genai
from .models import Transcript, Video

logger = logging.getLogger(__name__)


def get_gemini_model(system_instruction=None):
    """Initialize and return the Gemini model."""
    api_key = os.environ.get('GOOGLE_API_KEY')
    if not api_key:
        raise ValueError('GOOGLE_API_KEY not configured')
    genai.configure(api_key=api_key)
    model_name = os.environ.get('GEMINI_MODEL', 'gemini-2.5-flash')
    if system_instruction:
        return genai.GenerativeModel(model_name, system_instruction=system_instruction)
    return genai.GenerativeModel(model_name)


def generate_summary(video_id):
    """Generate a short 2-4 sentence narrative summary for a video's transcript."""
    transcript = Transcript.get_by_video_id(video_id)
    if not transcript:
        return None, 'Transcript not found'
    if not transcript.get('content'):
        return None, 'Transcript has no content'

    video = Video.get_by_video_id(video_id)
    video_title = video['videoTitle'] if video else 'Unknown'
    video_url = f"https://www.youtube.com/watch?v={video_id}"

    model = get_gemini_model()

    prompt = (
        "Summarize the following YouTube video transcript in 2-4 concise sentences. "
        "Cover the main topic, key points, and conclusion. Be brief and direct.\n\n"
        f"Video Title: {video_title}\n"
        f"Video URL: {video_url}\n\n"
        f"Transcript:\n{transcript['content']}"
    )

    response = model.generate_content(prompt)
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
    video_url = f"https://www.youtube.com/watch?v={video_id}"

    model = get_gemini_model()

    prompt = (
        "Extract frequently asked questions and their answers from the following YouTube video transcript. "
        "Identify the key questions that a viewer might have after watching this video, and provide clear, "
        "concise answers based on the transcript content.\n\n"
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

    response = model.generate_content(prompt)
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
                context_parts.append(f"=== Video: {title} (videoId: {video_id}) ===\n{content}")
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
        "of YouTube video transcripts. Use the following transcript context to answer "
        "the user's question. If the context doesn't contain relevant information, say so "
        "honestly. Always mention which video(s) your answer is based on when applicable.\n\n"
        "IMPORTANT: When citing specific timestamps from a video, use this exact format: "
        "[M:SS](videoId) — for example [7:11](dQw4w9WgXcQ). This allows the user to click "
        "the timestamp to jump to that moment in the video. Always use the videoId provided "
        "in the context header for each video. For timestamp ranges, format each timestamp "
        "separately, e.g. [7:11](abc123) to [8:07](abc123).\n\n"
        f"Knowledge Base Context:\n{context}"
    )

    # Create model with system instruction
    model = get_gemini_model(system_instruction=system_prompt)

    # Build message history for Gemini
    messages = []
    if conversation_history:
        for msg in conversation_history:
            role = 'user' if msg['role'] == 'user' else 'model'
            messages.append({'role': role, 'parts': [msg['content']]})

    messages.append({'role': 'user', 'parts': [user_message]})

    # Stream the response
    response = model.generate_content(
        contents=messages,
        stream=True
    )

    for chunk in response:
        if chunk.text:
            yield chunk.text
