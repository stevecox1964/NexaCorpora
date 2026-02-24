import math
import logging
import struct
import numpy as np
from sklearn.cluster import KMeans
from .database import get_db
from .embedding_service import EMBEDDING_DIM

logger = logging.getLogger(__name__)


def _deserialize_float32(blob):
    """Convert a sqlite-vec BLOB back to a list of floats."""
    n = len(blob) // 4
    return list(struct.unpack(f'{n}f', blob))


def _get_video_embeddings():
    """Return {video_id: mean_embedding_vector} for all embedded videos."""
    db = get_db()
    rows = db.execute('''
        SELECT tc.video_id, vc.embedding
        FROM vec_chunks vc
        JOIN transcript_chunks tc ON tc.id = vc.chunk_id
    ''').fetchall()

    per_video = {}
    for row in rows:
        vid = row['video_id']
        vec = _deserialize_float32(row['embedding'])
        per_video.setdefault(vid, []).append(vec)

    video_means = {}
    for vid, vecs in per_video.items():
        video_means[vid] = np.mean(vecs, axis=0)

    return video_means


def _label_cluster(video_ids):
    """Use Gemini to generate a short topic label for a group of videos."""
    db = get_db()
    placeholders = ','.join('?' for _ in video_ids)
    rows = db.execute(f'''
        SELECT v.video_title, v.channel_name, t.summary
        FROM videos v
        LEFT JOIN transcripts t ON v.video_id = t.video_id
        WHERE v.video_id IN ({placeholders})
    ''', list(video_ids)).fetchall()

    descriptions = []
    for r in rows:
        line = r['video_title'] or 'Untitled'
        if r['channel_name']:
            line += f" (by {r['channel_name']})"
        if r['summary']:
            line += f"\nSummary: {r['summary'][:300]}"
        descriptions.append(line)

    prompt = (
        "Below is a list of YouTube videos that have been grouped together by topic similarity. "
        "Generate a short, descriptive topic label (2-5 words) that best describes the common theme. "
        "Return ONLY the label text, nothing else.\n\n"
        + "\n---\n".join(descriptions)
    )

    try:
        from .gemini_service import get_gemini_model
        model = get_gemini_model()
        response = model.generate_content(prompt)
        label = response.text.strip().strip('"').strip("'")
        return label[:100]
    except Exception as e:
        logger.warning(f'Gemini labeling failed: {e}')
        return f'Topic {hash(tuple(video_ids)) % 1000}'


def build_clusters(n_clusters=None):
    """Run k-means clustering over per-video mean embeddings, label with Gemini."""
    video_means = _get_video_embeddings()

    if len(video_means) < 2:
        raise ValueError('Need at least 2 embedded videos to cluster')

    video_ids = list(video_means.keys())
    matrix = np.array([video_means[vid] for vid in video_ids], dtype=np.float32)

    if n_clusters is None:
        n_clusters = min(max(3, int(math.sqrt(len(video_ids)))), 15)
    n_clusters = min(n_clusters, len(video_ids))

    kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
    labels = kmeans.fit_predict(matrix)

    # Group video IDs by cluster
    clusters = {}
    for vid, label in zip(video_ids, labels):
        clusters.setdefault(int(label), []).append(vid)

    db = get_db()

    # Clear old assignments
    db.execute('DELETE FROM video_clusters')
    db.execute('DELETE FROM cluster_labels')

    # Store new assignments and generate labels
    cluster_info = []
    for cluster_id, vids in sorted(clusters.items()):
        # Generate descriptive label via Gemini
        label = _label_cluster(vids)

        db.execute(
            'INSERT INTO cluster_labels (cluster_id, label, video_count) VALUES (?, ?, ?)',
            (cluster_id, label, len(vids))
        )

        for vid in vids:
            db.execute(
                'INSERT INTO video_clusters (video_id, cluster_id) VALUES (?, ?)',
                (vid, cluster_id)
            )

        cluster_info.append({
            'clusterId': cluster_id,
            'label': label,
            'videoCount': len(vids),
        })

    db.commit()
    logger.info(f'Built {n_clusters} clusters from {len(video_ids)} videos')

    return {
        'clusters': cluster_info,
        'totalVideos': len(video_ids),
        'totalClusters': n_clusters,
    }
