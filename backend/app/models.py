from .database import get_db
from datetime import datetime
import uuid

class Video:
    @staticmethod
    def get_all(limit=20, offset=0):
        db = get_db()
        cursor = db.execute('''
            SELECT v.*,
                   (t.id IS NOT NULL) AS has_transcript,
                   j.status AS job_status
            FROM videos v
            LEFT JOIN transcripts t ON v.video_id = t.video_id
            LEFT JOIN jobs j ON v.video_id = j.video_id
                AND j.job_type = 'transcribe'
                AND j.status NOT IN ('completed', 'failed')
            ORDER BY v.scraped_at DESC, v.created_at DESC
            LIMIT ? OFFSET ?
        ''', (limit, offset))
        rows = cursor.fetchall()
        return [Video.row_to_dict(row) for row in rows]

    @staticmethod
    def count_all():
        db = get_db()
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
                    scraped_at, video_id, video_title, video_url
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                data.get('channelId'),
                data.get('channelIdSource'),
                data.get('channelName'),
                data.get('channelUrl'),
                data.get('scrapedAt', datetime.utcnow().isoformat()),
                data['videoId'],
                data['videoTitle'],
                data.get('videoUrl')
            ))
            db.commit()
            return Video.get_by_video_id(data['videoId'])
        except Exception as e:
            db.rollback()
            raise e

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
        if 'has_transcript' in row.keys():
            result['hasTranscript'] = bool(row['has_transcript'])
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
    def create(video_id, content):
        db = get_db()
        try:
            db.execute('''
                INSERT INTO transcripts (video_id, content)
                VALUES (?, ?)
            ''', (video_id, content))
            db.commit()
            return Transcript.get_by_video_id(video_id)
        except Exception as e:
            db.rollback()
            raise e

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
        if 'video_title' in row.keys():
            result['videoTitle'] = row['video_title']
            result['videoUrl'] = row['video_url']
        return result


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
