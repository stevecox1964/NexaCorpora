from .database import get_db
from datetime import datetime
import json
import uuid


class Setting:
    @staticmethod
    def get(key):
        db = get_db()
        cursor = db.execute('SELECT value FROM settings WHERE key = ?', (key,))
        row = cursor.fetchone()
        return row['value'] if row else None

    @staticmethod
    def set(key, value):
        db = get_db()
        db.execute(
            'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
            (key, value, datetime.utcnow().isoformat())
        )
        db.commit()

    @staticmethod
    def get_all():
        db = get_db()
        cursor = db.execute('SELECT key, value FROM settings')
        return {row['key']: row['value'] for row in cursor.fetchall()}

class Video:
    @staticmethod
    def get_all(limit=20, offset=0, video_type=None):
        """video_type: None (all), 'youtube', or 'web'."""
        db = get_db()
        type_filter = "WHERE COALESCE(v.type, 'youtube') = ?" if video_type else ''
        params = ([video_type] if video_type else []) + [limit, offset]
        cursor = db.execute(f'''
            SELECT v.*,
                   (t.id IS NOT NULL) AS has_transcript,
                   (t.summary IS NOT NULL AND t.summary != '') AS has_summary,
                   (t.faq IS NOT NULL AND t.faq != '') AS has_faq,
                   t.provider AS transcript_provider,
                   j.status AS job_status
            FROM videos v
            LEFT JOIN transcripts t ON v.video_id = t.video_id
            LEFT JOIN jobs j ON v.video_id = j.video_id
                AND j.job_type = 'transcribe'
                AND j.status NOT IN ('completed', 'failed')
            {type_filter}
            ORDER BY v.scraped_at DESC, v.created_at DESC
            LIMIT ? OFFSET ?
        ''', params)
        rows = cursor.fetchall()
        return [Video.row_to_dict(row) for row in rows]

    @staticmethod
    def count_all(video_type=None):
        db = get_db()
        if video_type:
            cursor = db.execute(
                "SELECT COUNT(*) as count FROM videos WHERE COALESCE(type, 'youtube') = ?", (video_type,)
            )
        else:
            cursor = db.execute('SELECT COUNT(*) as count FROM videos')
        row = cursor.fetchone()
        return row['count'] if row else 0

    @staticmethod
    def get_by_video_id(video_id):
        db = get_db()
        cursor = db.execute('''
            SELECT * FROM videos WHERE video_id = ?
        ''', (video_id,))
        row = cursor.fetchone()
        return Video.row_to_dict(row) if row else None

    @staticmethod
    def create(data):
        db = get_db()
        try:
            db.execute('''
                INSERT INTO videos (
                    channel_id, channel_id_source, channel_name, channel_url,
                    scraped_at, video_id, video_title, video_url,
                    type, thumbnail_url, page_text
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                data.get('channelId'),
                data.get('channelIdSource'),
                data.get('channelName'),
                data.get('channelUrl'),
                data.get('scrapedAt', datetime.utcnow().isoformat()),
                data['videoId'],
                data['videoTitle'],
                data.get('videoUrl'),
                data.get('type', 'youtube'),
                data.get('thumbnailUrl'),
                data.get('pageText')
            ))
            db.commit()
            return Video.get_by_video_id(data['videoId'])
        except Exception as e:
            db.rollback()
            raise e

    @staticmethod
    def get_page_text(video_id):
        """Raw text scraped from a web page bookmark (None for YouTube videos)."""
        db = get_db()
        row = db.execute('SELECT page_text FROM videos WHERE video_id = ?', (video_id,)).fetchone()
        return row['page_text'] if row else None

    @staticmethod
    def delete(video_id):
        db = get_db()
        cursor = db.execute('''
            DELETE FROM videos WHERE video_id = ?
        ''', (video_id,))
        db.commit()
        return cursor.rowcount > 0

    @staticmethod
    def row_to_dict(row):
        if row is None:
            return None
        result = {
            'id': row['id'],
            'channelId': row['channel_id'],
            'channelIdSource': row['channel_id_source'],
            'channelName': row['channel_name'],
            'channelUrl': row['channel_url'],
            'scrapedAt': row['scraped_at'],
            'videoId': row['video_id'],
            'videoTitle': row['video_title'],
            'videoUrl': row['video_url'],
            'createdAt': row['created_at']
        }
        keys = row.keys()
        # page_text is intentionally not returned (can be very large); use get_page_text()
        result['type'] = (row['type'] if 'type' in keys else None) or 'youtube'
        result['thumbnailUrl'] = row['thumbnail_url'] if 'thumbnail_url' in keys else None
        if 'page_text' in keys:
            result['hasPageText'] = bool(row['page_text'])
        if 'has_transcript' in row.keys():
            result['hasTranscript'] = bool(row['has_transcript'])
        if 'has_summary' in row.keys():
            result['hasSummary'] = bool(row['has_summary'])
        if 'has_faq' in row.keys():
            result['hasFaq'] = bool(row['has_faq'])
        if 'transcript_provider' in row.keys():
            result['transcriptProvider'] = row['transcript_provider']
        if 'job_status' in row.keys():
            result['transcriptJobStatus'] = row['job_status']
        return result


class Transcript:
    @staticmethod
    def get_by_video_id(video_id):
        db = get_db()
        cursor = db.execute('''
            SELECT * FROM transcripts WHERE video_id = ?
        ''', (video_id,))
        row = cursor.fetchone()
        return Transcript.row_to_dict(row) if row else None

    @staticmethod
    def search(query):
        db = get_db()
        cursor = db.execute('''
            SELECT t.*, v.video_title, v.video_url
            FROM transcripts t
            JOIN videos v ON t.video_id = v.video_id
            WHERE t.content LIKE ?
            LIMIT 20
        ''', (f'%{query}%',))
        rows = cursor.fetchall()
        return [Transcript.row_to_dict(row) for row in rows]

    @staticmethod
    def create(video_id, content, provider=None):
        db = get_db()
        try:
            db.execute('''
                INSERT INTO transcripts (video_id, content, provider)
                VALUES (?, ?, ?)
            ''', (video_id, content, provider))
            db.commit()
            return Transcript.get_by_video_id(video_id)
        except Exception as e:
            db.rollback()
            raise e

    @staticmethod
    def update_summary(video_id, summary):
        db = get_db()
        db.execute('UPDATE transcripts SET summary = ? WHERE video_id = ?', (summary, video_id))
        db.commit()
        return Transcript.get_by_video_id(video_id)

    @staticmethod
    def update_faq(video_id, faq):
        db = get_db()
        db.execute('UPDATE transcripts SET faq = ? WHERE video_id = ?', (faq, video_id))
        db.commit()
        return Transcript.get_by_video_id(video_id)

    @staticmethod
    def delete(video_id):
        db = get_db()
        # Delete embeddings first (vec_chunks references transcript_chunks)
        chunk_ids = [row['id'] for row in db.execute(
            'SELECT id FROM transcript_chunks WHERE video_id = ?', (video_id,)
        ).fetchall()]
        if chunk_ids:
            placeholders = ','.join('?' * len(chunk_ids))
            db.execute(f'DELETE FROM vec_chunks WHERE chunk_id IN ({placeholders})', chunk_ids)
            db.execute('DELETE FROM transcript_chunks WHERE video_id = ?', (video_id,))
        db.execute('DELETE FROM transcripts WHERE video_id = ?', (video_id,))
        db.commit()

    @staticmethod
    def get_all_summaries():
        db = get_db()
        cursor = db.execute('''
            SELECT t.video_id, t.summary, t.faq, v.video_title, v.channel_name
            FROM transcripts t
            JOIN videos v ON t.video_id = v.video_id
            WHERE (t.summary IS NOT NULL AND t.summary != '')
               OR (t.faq IS NOT NULL AND t.faq != '')
            ORDER BY v.scraped_at DESC
        ''')
        return [dict(row) for row in cursor.fetchall()]

    @staticmethod
    def row_to_dict(row):
        if row is None:
            return None
        result = {
            'id': row['id'],
            'videoId': row['video_id'],
            'content': row['content'],
            'indexedAt': row['indexed_at']
        }
        if 'summary' in row.keys():
            result['summary'] = row['summary']
        if 'faq' in row.keys():
            result['faq'] = row['faq']
        if 'provider' in row.keys():
            result['provider'] = row['provider']
        if 'video_title' in row.keys():
            result['videoTitle'] = row['video_title']
            result['videoUrl'] = row['video_url']
        return result


class Brain:
    @staticmethod
    def create(name, description=''):
        db = get_db()
        brain_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()
        db.execute(
            'INSERT INTO brains (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
            (brain_id, name, description, now, now)
        )
        db.commit()
        return Brain.get_by_id(brain_id)

    @staticmethod
    def get_by_id(brain_id):
        db = get_db()
        row = db.execute('''
            SELECT b.*, COUNT(bv.video_id) as video_count
            FROM brains b
            LEFT JOIN brain_videos bv ON b.id = bv.brain_id
            WHERE b.id = ?
            GROUP BY b.id
        ''', (brain_id,)).fetchone()
        return Brain.row_to_dict(row)

    @staticmethod
    def get_all():
        db = get_db()
        rows = db.execute('''
            SELECT b.*, COUNT(bv.video_id) as video_count
            FROM brains b
            LEFT JOIN brain_videos bv ON b.id = bv.brain_id
            GROUP BY b.id
            ORDER BY b.updated_at DESC
        ''').fetchall()
        return [Brain.row_to_dict(row) for row in rows]

    @staticmethod
    def update(brain_id, name=None, description=None):
        db = get_db()
        updates = []
        params = []
        if name is not None:
            updates.append('name = ?')
            params.append(name)
        if description is not None:
            updates.append('description = ?')
            params.append(description)
        if updates:
            updates.append('updated_at = ?')
            params.append(datetime.utcnow().isoformat())
            params.append(brain_id)
            db.execute(f'UPDATE brains SET {", ".join(updates)} WHERE id = ?', params)
            db.commit()
        return Brain.get_by_id(brain_id)

    @staticmethod
    def delete(brain_id):
        db = get_db()
        db.execute('DELETE FROM brain_videos WHERE brain_id = ?', (brain_id,))
        cursor = db.execute('DELETE FROM brains WHERE id = ?', (brain_id,))
        db.commit()
        return cursor.rowcount > 0

    @staticmethod
    def add_video(brain_id, video_id):
        db = get_db()
        try:
            db.execute(
                'INSERT OR IGNORE INTO brain_videos (brain_id, video_id) VALUES (?, ?)',
                (brain_id, video_id)
            )
            db.execute(
                'UPDATE brains SET updated_at = ? WHERE id = ?',
                (datetime.utcnow().isoformat(), brain_id)
            )
            db.commit()
            return True
        except Exception:
            return False

    @staticmethod
    def remove_video(brain_id, video_id):
        db = get_db()
        cursor = db.execute(
            'DELETE FROM brain_videos WHERE brain_id = ? AND video_id = ?',
            (brain_id, video_id)
        )
        db.execute(
            'UPDATE brains SET updated_at = ? WHERE id = ?',
            (datetime.utcnow().isoformat(), brain_id)
        )
        db.commit()
        return cursor.rowcount > 0

    @staticmethod
    def get_video_ids(brain_id):
        db = get_db()
        rows = db.execute(
            'SELECT video_id FROM brain_videos WHERE brain_id = ?', (brain_id,)
        ).fetchall()
        return [row['video_id'] for row in rows]

    @staticmethod
    def get_videos(brain_id):
        db = get_db()
        rows = db.execute('''
            SELECT v.*,
                   (t.id IS NOT NULL) AS has_transcript,
                   (t.summary IS NOT NULL AND t.summary != '') AS has_summary,
                   (t.faq IS NOT NULL AND t.faq != '') AS has_faq,
                   t.provider AS transcript_provider
            FROM brain_videos bv
            JOIN videos v ON v.video_id = bv.video_id
            LEFT JOIN transcripts t ON v.video_id = t.video_id
            WHERE bv.brain_id = ?
            ORDER BY bv.added_at DESC
        ''', (brain_id,)).fetchall()
        return [Video.row_to_dict(row) for row in rows]

    @staticmethod
    def get_thumbnail_videos(brain_id, limit=4):
        """Minimal video dicts for the brain card grid: YouTube ids or web page screenshots."""
        db = get_db()
        rows = db.execute('''
            SELECT bv.video_id, v.type, v.thumbnail_url FROM brain_videos bv
            JOIN videos v ON v.video_id = bv.video_id
            WHERE bv.brain_id = ?
            LIMIT ?
        ''', (brain_id, limit)).fetchall()
        return [
            {'videoId': r['video_id'], 'type': r['type'] or 'youtube', 'thumbnailUrl': r['thumbnail_url']}
            for r in rows
        ]

    @staticmethod
    def get_brains_for_video(video_id):
        db = get_db()
        rows = db.execute('''
            SELECT b.id, b.name
            FROM brain_videos bv
            JOIN brains b ON b.id = bv.brain_id
            WHERE bv.video_id = ?
        ''', (video_id,)).fetchall()
        return [{'id': row['id'], 'name': row['name']} for row in rows]

    @staticmethod
    def set_provider(brain_id, provider, config):
        db = get_db()
        db.execute(
            'UPDATE brains SET provider = ?, provider_config = ?, provider_synced_at = ?, updated_at = ? WHERE id = ?',
            (
                provider,
                json.dumps(config) if config is not None else None,
                datetime.utcnow().isoformat(),
                datetime.utcnow().isoformat(),
                brain_id,
            )
        )
        db.commit()

    @staticmethod
    def clear_provider(brain_id):
        db = get_db()
        db.execute(
            'UPDATE brains SET provider = NULL, provider_config = NULL, provider_synced_at = NULL, updated_at = ? WHERE id = ?',
            (datetime.utcnow().isoformat(), brain_id)
        )
        db.execute(
            'DELETE FROM brain_provider_files WHERE brain_id = ?',
            (brain_id,)
        )
        db.commit()

    @staticmethod
    def get_provider_files(brain_id, provider):
        db = get_db()
        rows = db.execute(
            'SELECT video_id, remote_file_id FROM brain_provider_files WHERE brain_id = ? AND provider = ?',
            (brain_id, provider)
        ).fetchall()
        return {row['video_id']: row['remote_file_id'] for row in rows}

    @staticmethod
    def record_provider_file(brain_id, provider, video_id, remote_file_id):
        db = get_db()
        db.execute(
            'INSERT OR REPLACE INTO brain_provider_files (brain_id, provider, video_id, remote_file_id) VALUES (?, ?, ?, ?)',
            (brain_id, provider, video_id, remote_file_id)
        )
        db.commit()

    @staticmethod
    def remove_provider_file(brain_id, provider, video_id):
        db = get_db()
        db.execute(
            'DELETE FROM brain_provider_files WHERE brain_id = ? AND provider = ? AND video_id = ?',
            (brain_id, provider, video_id)
        )
        db.commit()

    @staticmethod
    def row_to_dict(row):
        if row is None:
            return None
        keys = row.keys()
        provider_config = None
        if 'provider_config' in keys and row['provider_config']:
            try:
                provider_config = json.loads(row['provider_config'])
            except (ValueError, TypeError):
                provider_config = None
        return {
            'id': row['id'],
            'name': row['name'],
            'description': row['description'],
            'videoCount': row['video_count'] if 'video_count' in keys else 0,
            'createdAt': row['created_at'],
            'updatedAt': row['updated_at'],
            'provider': row['provider'] if 'provider' in keys else None,
            'providerConfig': provider_config,
            'providerSyncedAt': row['provider_synced_at'] if 'provider_synced_at' in keys else None,
        }


class SearchQuery:
    @staticmethod
    def save(query, result_count=None):
        db = get_db()
        db.execute(
            'INSERT INTO search_queries (query, result_count) VALUES (?, ?)',
            (query, result_count)
        )
        db.commit()

    @staticmethod
    def get_recent(limit=50):
        db = get_db()
        rows = db.execute(
            'SELECT id, query, result_count, searched_at FROM search_queries ORDER BY searched_at DESC LIMIT ?',
            (limit,)
        ).fetchall()
        return [{'id': r['id'], 'query': r['query'], 'resultCount': r['result_count'], 'searchedAt': r['searched_at']} for r in rows]


class SavedChat:
    @staticmethod
    def save(source, messages, brain_id=None):
        db = get_db()
        db.execute(
            'INSERT INTO saved_chats (source, brain_id, messages) VALUES (?, ?, ?)',
            (source, brain_id, json.dumps(messages))
        )
        db.commit()

    @staticmethod
    def get_recent(limit=50, source=None):
        db = get_db()
        if source:
            rows = db.execute(
                'SELECT id, source, brain_id, messages, saved_at FROM saved_chats WHERE source = ? ORDER BY saved_at DESC LIMIT ?',
                (source, limit)
            ).fetchall()
        else:
            rows = db.execute(
                'SELECT id, source, brain_id, messages, saved_at FROM saved_chats ORDER BY saved_at DESC LIMIT ?',
                (limit,)
            ).fetchall()
        return [SavedChat.row_to_dict(r) for r in rows]

    @staticmethod
    def get_by_id(chat_id):
        db = get_db()
        row = db.execute(
            'SELECT id, source, brain_id, messages, saved_at FROM saved_chats WHERE id = ?',
            (chat_id,)
        ).fetchone()
        return SavedChat.row_to_dict(row)

    @staticmethod
    def row_to_dict(row):
        if row is None:
            return None
        return {
            'id': row['id'],
            'source': row['source'],
            'brainId': row['brain_id'],
            'messages': json.loads(row['messages']),
            'savedAt': row['saved_at'],
        }


class Job:
    @staticmethod
    def create(video_id, job_type):
        db = get_db()
        job_id = str(uuid.uuid4())
        try:
            db.execute('''
                INSERT INTO jobs (id, video_id, job_type, status)
                VALUES (?, ?, ?, 'pending')
            ''', (job_id, video_id, job_type))
            db.commit()
            return Job.get_by_id(job_id)
        except Exception as e:
            db.rollback()
            raise e

    @staticmethod
    def get_by_id(job_id):
        db = get_db()
        cursor = db.execute('SELECT * FROM jobs WHERE id = ?', (job_id,))
        row = cursor.fetchone()
        return Job.row_to_dict(row) if row else None

    @staticmethod
    def get_active_by_video_id(video_id, job_type):
        db = get_db()
        cursor = db.execute('''
            SELECT * FROM jobs
            WHERE video_id = ? AND job_type = ?
              AND status NOT IN ('completed', 'failed')
            ORDER BY created_at DESC LIMIT 1
        ''', (video_id, job_type))
        row = cursor.fetchone()
        return Job.row_to_dict(row) if row else None

    @staticmethod
    def update_status(job_id, status, error_message=None):
        db = get_db()
        completed_at = datetime.utcnow().isoformat() if status in ('completed', 'failed') else None
        db.execute('''
            UPDATE jobs SET status = ?, error_message = ?, completed_at = ?
            WHERE id = ?
        ''', (status, error_message, completed_at, job_id))
        db.commit()

    @staticmethod
    def row_to_dict(row):
        if row is None:
            return None
        return {
            'id': row['id'],
            'videoId': row['video_id'],
            'jobType': row['job_type'],
            'status': row['status'],
            'errorMessage': row['error_message'],
            'createdAt': row['created_at'],
            'completedAt': row['completed_at']
        }
