import logging
import struct
import numpy as np
from sqlite_vec import serialize_float32
from .database import get_db
from .embedding_service import embed_texts
from .models import Brain

logger = logging.getLogger(__name__)

OVERFETCH_MULTIPLIER = 5


def _get_video_mean_embedding(db, video_id):
    """Get the mean embedding vector for a video from its chunks."""
    rows = db.execute('''
        SELECT vc.embedding
        FROM vec_chunks vc
        JOIN transcript_chunks tc ON tc.id = vc.chunk_id
        WHERE tc.video_id = ?
    ''', (video_id,)).fetchall()

    if not rows:
        return None

    vecs = []
    for row in rows:
        blob = row['embedding']
        n = len(blob) // 4
        vec = list(struct.unpack(f'{n}f', blob))
        vecs.append(vec)

    return np.mean(vecs, axis=0)


def search_brain(brain_id, query_text, k=8):
    """Semantic search scoped to a brain's videos.

    sqlite-vec can't filter during KNN, so we over-fetch and post-filter.
    """
    db = get_db()

    video_ids = set(Brain.get_video_ids(brain_id))
    if not video_ids:
        return []

    has_embeddings = db.execute('SELECT COUNT(*) as c FROM vec_chunks').fetchone()['c']
    if not has_embeddings:
        return []

    query_embedding = embed_texts([query_text])[0]
    fetch_k = min(k * OVERFETCH_MULTIPLIER, 200)

    rows = db.execute('''
        SELECT tc.video_id, tc.content, tc.chunk_index,
               v.video_title, v.channel_name,
               vc.distance
        FROM vec_chunks vc
        JOIN transcript_chunks tc ON tc.id = vc.chunk_id
        JOIN videos v ON v.video_id = tc.video_id
        WHERE vc.embedding MATCH ? AND k = ?
        ORDER BY vc.distance
    ''', [serialize_float32(query_embedding), fetch_k]).fetchall()

    filtered = [dict(row) for row in rows if row['video_id'] in video_ids]
    return filtered[:k]


def get_brain_context(brain_id, query_text, k=8):
    """Get RAG context scoped to a brain's videos."""
    context = None

    try:
        results = search_brain(brain_id, query_text, k=k)
        if results:
            context_parts = []
            for r in results:
                title = r.get('video_title', 'Unknown')
                video_id = r.get('video_id', '')
                content = r.get('content', '')
                context_parts.append(
                    f"=== Video: {title} (videoId: {video_id}) ===\n{content}"
                )
            context = "\n\n".join(context_parts)
    except Exception as e:
        logger.warning(f'Brain vector search failed: {e}')

    # Fallback: summaries from brain's videos only
    if not context:
        video_ids = Brain.get_video_ids(brain_id)
        if video_ids:
            db = get_db()
            placeholders = ','.join('?' * len(video_ids))
            rows = db.execute(f'''
                SELECT t.video_id, t.summary, t.faq, v.video_title, v.channel_name
                FROM transcripts t
                JOIN videos v ON t.video_id = v.video_id
                WHERE t.video_id IN ({placeholders})
                  AND ((t.summary IS NOT NULL AND t.summary != '')
                    OR (t.faq IS NOT NULL AND t.faq != ''))
                ORDER BY v.scraped_at DESC
            ''', video_ids).fetchall()

            if rows:
                context_parts = []
                for s in rows:
                    parts = [f"Video: {s['video_title']} (videoId: {s['video_id']}, by {s['channel_name']})"]
                    if s['summary']:
                        parts.append(f"Summary: {s['summary']}")
                    if s['faq']:
                        parts.append(f"FAQ: {s['faq']}")
                    context_parts.append("\n".join(parts))
                context = "\n\n".join(context_parts)

    if not context:
        context = "This brain has no transcripts or embeddings yet."

    return context


def chat_with_brain(brain_id, user_message, conversation_history=None):
    """Generator that yields text chunks for SSE streaming. Brain-scoped RAG."""
    from .gemini_service import get_gemini_model

    brain = Brain.get_by_id(brain_id)
    brain_name = brain['name'] if brain else 'Unknown Brain'

    context = get_brain_context(brain_id, user_message, k=8)

    system_prompt = (
        f"You are a helpful assistant for the knowledge base called \"{brain_name}\". "
        "This knowledge base is a curated collection of YouTube video transcripts. "
        "Use the following transcript context to answer the user's question. "
        "If the context doesn't contain relevant information, say so honestly. "
        "Always mention which video(s) your answer is based on when applicable.\n\n"
        "IMPORTANT: When citing specific timestamps from a video, use this exact format: "
        "[M:SS](videoId) — for example [7:11](dQw4w9WgXcQ). This allows the user to "
        "click the timestamp to jump to that moment in the video. Always use the videoId "
        "provided in the context header for each video. For timestamp ranges, format each "
        "timestamp separately, e.g. [7:11](abc123) to [8:07](abc123).\n\n"
        f"Knowledge Base Context:\n{context}"
    )

    model = get_gemini_model(system_instruction=system_prompt)

    messages = []
    if conversation_history:
        for msg in conversation_history:
            role = 'user' if msg['role'] == 'user' else 'model'
            messages.append({'role': role, 'parts': [msg['content']]})

    messages.append({'role': 'user', 'parts': [user_message]})

    response = model.generate_content(contents=messages, stream=True)

    for chunk in response:
        if chunk.text:
            yield chunk.text


def suggest_brains_for_video(video_id, threshold=0.75):
    """Suggest brains a video might belong to based on embedding similarity.

    Compares the video's mean embedding to each brain's mean embedding.
    Returns list of {id, name, similarity} sorted by similarity desc.
    """
    db = get_db()

    video_vec = _get_video_mean_embedding(db, video_id)
    if video_vec is None:
        return []

    brains = Brain.get_all()
    if not brains:
        return []

    video_vec_norm = video_vec / (np.linalg.norm(video_vec) + 1e-10)
    suggestions = []

    for brain in brains:
        brain_video_ids = Brain.get_video_ids(brain['id'])
        # Skip if video is already in this brain or brain is empty
        if not brain_video_ids or video_id in brain_video_ids:
            continue

        brain_vecs = []
        for bvid in brain_video_ids:
            vec = _get_video_mean_embedding(db, bvid)
            if vec is not None:
                brain_vecs.append(vec)

        if not brain_vecs:
            continue

        brain_mean = np.mean(brain_vecs, axis=0)
        brain_mean_norm = brain_mean / (np.linalg.norm(brain_mean) + 1e-10)
        similarity = float(np.dot(video_vec_norm, brain_mean_norm))

        if similarity >= threshold:
            suggestions.append({
                'id': brain['id'],
                'name': brain['name'],
                'similarity': round(similarity, 3),
            })

    suggestions.sort(key=lambda x: x['similarity'], reverse=True)
    return suggestions


def auto_assign_by_channel(video_id):
    """Auto-assign a video to brains that already contain videos from the same channel.

    Called immediately when a video is added (before transcription/embeddings exist).
    Strategy: find the single best-fit brain for this channel and only assign there.
    A brain is a candidate if the channel makes up >=50% of its videos (channel-focused brain).
    If multiple candidates exist, pick the one with the highest channel ratio.
    If no brain has >=50%, don't auto-assign — the user can manually add it.
    """
    from .models import Video
    video = Video.get_by_video_id(video_id)
    if not video or not video.get('channelName'):
        return []

    channel_name = video['channelName'].strip().lower()
    if not channel_name:
        return []

    db = get_db()
    brains_all = Brain.get_all()
    best_brain = None
    best_ratio = 0

    for brain in brains_all:
        video_ids = Brain.get_video_ids(brain['id'])
        if video_id in video_ids:
            continue
        if not video_ids:
            continue

        # Count how many of this brain's videos are from the same channel
        placeholders = ','.join('?' * len(video_ids))
        rows = db.execute(f'''
            SELECT LOWER(TRIM(channel_name)) as cn
            FROM videos
            WHERE video_id IN ({placeholders}) AND channel_name IS NOT NULL
        ''', video_ids).fetchall()

        total_videos = len(video_ids)
        channel_count = sum(1 for row in rows if row['cn'] == channel_name)

        if channel_count == 0:
            continue

        channel_ratio = channel_count / total_videos

        # Only consider brains where this channel is the majority of content
        if channel_ratio >= 0.5 and channel_ratio > best_ratio:
            best_brain = brain
            best_ratio = channel_ratio

    assigned = []
    if best_brain:
        Brain.add_video(best_brain['id'], video_id)
        assigned.append(best_brain['name'])
        logger.info(
            f'Channel-assigned video {video_id} to brain "{best_brain["name"]}" '
            f'(channel: {video["channelName"]}, ratio: {best_ratio:.0%})'
        )

    return assigned


def auto_assign_video(video_id, auto_threshold=0.90):
    """Auto-assign a video to brains with high similarity. Returns assigned brain names."""
    suggestions = suggest_brains_for_video(video_id, threshold=auto_threshold)
    assigned = []

    for s in suggestions:
        Brain.add_video(s['id'], video_id)
        assigned.append(s['name'])
        logger.info(f'Auto-assigned video {video_id} to brain "{s["name"]}" (similarity: {s["similarity"]})')

    return assigned
