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


SECTION_HEADERS = {
    'structured': '--- Structured Summary ---',
    'narrative': '--- Narrative Summary ---',
    'faq': '--- FAQ Extraction ---',
}


def generate_summary(video_id, summary_type='structured'):
    """Generate a summary for a video's transcript using Gemini.

    Reads the transcript from the database (no re-downloading),
    sends it to Gemini, and appends the result to the existing summary.

    summary_type: 'structured', 'narrative', or 'faq'.
    Each type appends with a section header rather than overwriting.
    """
    transcript = Transcript.get_by_video_id(video_id)
    if not transcript:
        return None, 'Transcript not found'
    if not transcript.get('content'):
        return None, 'Transcript has no content'

    video = Video.get_by_video_id(video_id)
    video_title = video['videoTitle'] if video else 'Unknown'

    model = get_gemini_model()

    video_url = f"https://www.youtube.com/watch?v={video_id}"

    if summary_type == 'narrative':
        prompt = (
            "Summarize the following YouTube video transcript in 2-4 concise paragraphs. "
            "Include the key topics, main arguments, and any notable conclusions.\n\n"
            f"Video Title: {video_title}\n"
            f"Video URL: {video_url}\n\n"
            f"Transcript:\n{transcript['content']}"
        )
    elif summary_type == 'faq':
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
    else:
        prompt = (
            "You are a technical documentation generator. "
            "Analyze the transcript and extract structured FAQ-style technical information.\n"
            "Return the response in this format:\n\n"
            "## Project Overview\n"
            "- Name:\n"
            "- Purpose:\n"
            "- Target Users:\n\n"
            "## Tech Stack\n"
            "- Operating System:\n"
            "- Programming Languages:\n"
            "- Backend Framework:\n"
            "- Frontend Framework:\n"
            "- UI Library:\n"
            "- Database:\n"
            "- APIs Used:\n"
            "- AI Models Used:\n"
            "- Cloud Provider:\n"
            "- Deployment Platform:\n\n"
            "## Architecture\n"
            "- Pattern Used:\n"
            "- Infrastructure:\n"
            "- Authentication:\n"
            "- Data Storage Strategy:\n\n"
            "## DevOps\n"
            "- CI/CD:\n"
            "- Containerization:\n"
            "- Environment Variables Mentioned:\n\n"
            "## Features\n"
            "- Core Features:\n"
            "- Integrations:\n"
            "- Security Features:\n\n"
            "## Monetization\n"
            "- Pricing Model:\n"
            "- Subscription / Credits / Pay-per-use:\n\n"
            "## Known Issues / Limitations\n\n"
            "If a category is not mentioned, state \"Not specified.\"\n"
            "Do not summarize the transcript narratively. Only extract structured facts.\n\n"
            f"Video Title: {video_title}\n"
            f"Video URL: {video_url}\n\n"
            f"Transcript:\n{transcript['content']}"
        )

    response = model.generate_content(prompt)
    new_text = response.text

    # Append with section header instead of overwriting
    header = SECTION_HEADERS.get(summary_type, SECTION_HEADERS['structured'])
    section = f"{header}\nVideo: {video_title}\n{video_url}\n\n{new_text}"

    existing = transcript.get('summary') or ''
    if existing.strip():
        summary_text = f"{existing}\n\n{section}"
    else:
        summary_text = section

    updated = Transcript.update_summary(video_id, summary_text)
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
                context_parts.append(
                    f"Video: {s['video_title']} (videoId: {s['video_id']}, by {s['channel_name']})\n"
                    f"Summary: {s['summary']}"
                )
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
