import os
import json
from flask import Blueprint, request, jsonify, current_app, Response, stream_with_context
from .models import Video, Job, Transcript, Setting
from .bookmarks import get_chrome_youtube_bookmarks
from . import transcripts
from .transcription_service import start_transcription

bp = Blueprint('api', __name__, url_prefix='/api')


@bp.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    return jsonify({'status': 'ok', 'message': 'Server is running'})


# Video endpoints

@bp.route('/videos', methods=['GET'])
def get_videos():
    """Get list of videos (latest to oldest) with pagination."""
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    
    # Clamp values
    page = max(page, 1)
    per_page = min(max(per_page, 1), 100)
    
    # Calculate offset
    offset = (page - 1) * per_page
    
    # Get total count and videos
    total = Video.count_all()
    videos = Video.get_all(limit=per_page, offset=offset)
    
    # Calculate total pages
    total_pages = (total + per_page - 1) // per_page if total > 0 else 1
    
    return jsonify({
        'success': True,
        'videos': videos,
        'pagination': {
            'page': page,
            'per_page': per_page,
            'total': total,
            'total_pages': total_pages,
            'has_prev': page > 1,
            'has_next': page < total_pages
        }
    })


@bp.route('/videos', methods=['POST'])
def add_video():
    """Add a new video bookmark."""
    data = request.get_json()

    if not data:
        return jsonify({'success': False, 'error': 'No data provided'}), 400

    required_fields = ['videoId', 'videoTitle']
    for field in required_fields:
        if field not in data:
            return jsonify({'success': False, 'error': f'Missing required field: {field}'}), 400

    # Check if video already exists
    existing = Video.get_by_video_id(data['videoId'])
    if existing:
        return jsonify({
            'success': False,
            'error': 'Video already exists',
            'video': existing
        }), 409

    try:
        video = Video.create(data)
        return jsonify({
            'success': True,
            'video': video
        }), 201
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/videos/<video_id>', methods=['GET'])
def get_video(video_id):
    """Get a specific video by ID."""
    video = Video.get_by_video_id(video_id)
    if not video:
        return jsonify({'success': False, 'error': 'Video not found'}), 404

    return jsonify({
        'success': True,
        'video': video
    })


@bp.route('/videos/<video_id>', methods=['DELETE'])
def delete_video(video_id):
    """Delete a video bookmark."""
    deleted = Video.delete(video_id)
    if not deleted:
        return jsonify({'success': False, 'error': 'Video not found'}), 404

    return jsonify({
        'success': True,
        'message': f'Video {video_id} deleted'
    })


# Chrome bookmarks endpoints

@bp.route('/bookmarks/chrome', methods=['GET'])
def get_chrome_bookmarks():
    """Get YouTube bookmarks from Chrome browser."""
    result = get_chrome_youtube_bookmarks()
    status_code = 200 if result['success'] else 500
    return jsonify(result), status_code


@bp.route('/bookmarks/chrome/import', methods=['POST'])
def import_chrome_bookmarks():
    """Import YouTube bookmarks from Chrome into the database."""
    result = get_chrome_youtube_bookmarks()

    if not result['success']:
        return jsonify(result), 500

    imported = 0
    skipped = 0
    errors = []

    for bookmark in result['bookmarks']:
        try:
            existing = Video.get_by_video_id(bookmark['videoId'])
            if existing:
                skipped += 1
                continue

            Video.create(bookmark)
            imported += 1
        except Exception as e:
            errors.append({
                'videoId': bookmark['videoId'],
                'error': str(e)
            })

    return jsonify({
        'success': True,
        'imported': imported,
        'skipped': skipped,
        'errors': errors,
        'total': len(result['bookmarks'])
    })


# Transcript endpoints (STUBS)

@bp.route('/transcripts/search', methods=['GET'])
def search_transcripts_endpoint():
    """Search indexed transcripts."""
    query = request.args.get('q', '')
    result = transcripts.search_transcripts(query)
    status_code = 200 if result['success'] else 400
    return jsonify(result), status_code


@bp.route('/transcripts/index', methods=['POST'])
def index_transcript():
    """Index transcript for a video."""
    data = request.get_json()

    if not data or 'videoId' not in data:
        return jsonify({
            'success': False,
            'error': 'videoId is required'
        }), 400

    result = transcripts.index_transcript(data['videoId'])
    status_code = 200 if result['success'] else 400
    return jsonify(result), status_code


@bp.route('/transcripts/<video_id>', methods=['GET'])
def get_transcript(video_id):
    """Get transcript content for a video."""
    transcript = Transcript.get_by_video_id(video_id)
    if not transcript:
        return jsonify({'success': False, 'error': 'Transcript not found'}), 404
    return jsonify({'success': True, 'transcript': transcript})


@bp.route('/transcripts/<video_id>/status', methods=['GET'])
def get_transcript_status(video_id):
    """Get transcript indexing status for a video."""
    result = transcripts.get_transcript_status(video_id)
    return jsonify(result)


# Transcription endpoints

@bp.route('/transcribe/<video_id>', methods=['POST'])
def transcribe_video(video_id):
    """Start a transcription job for a video. Provider is read from settings table."""
    job, error, status_code = start_transcription(current_app._get_current_object(), video_id)

    if error:
        response = {'success': False, 'error': error}
        if job:
            response['job'] = job
        return jsonify(response), status_code

    return jsonify({'success': True, 'job': job}), 202


# Job endpoints

@bp.route('/jobs/<job_id>', methods=['GET'])
def get_job(job_id):
    """Get job status by ID."""
    job = Job.get_by_id(job_id)
    if not job:
        return jsonify({'success': False, 'error': 'Job not found'}), 404
    return jsonify({'success': True, 'job': job})


@bp.route('/jobs/video/<video_id>', methods=['GET'])
def get_video_job(video_id):
    """Get the active transcription job for a video."""
    job = Job.get_active_by_video_id(video_id, 'transcribe')
    return jsonify({'success': True, 'job': job})


# Chat endpoints

@bp.route('/chat', methods=['POST'])
def chat():
    """Stream a chat response using Gemini with transcript context."""
    data = request.get_json()
    if not data or 'message' not in data:
        return jsonify({'success': False, 'error': 'Message is required'}), 400

    user_message = data['message']
    conversation_history = data.get('history', [])

    try:
        from .gemini_service import chat_with_knowledge_base

        def generate():
            try:
                for chunk in chat_with_knowledge_base(user_message, conversation_history):
                    yield f"data: {json.dumps({'text': chunk})}\n\n"
                yield f"data: {json.dumps({'done': True})}\n\n"
            except ValueError as e:
                yield f"data: {json.dumps({'error': str(e)})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'error': f'Chat failed: {str(e)}'})}\n\n"

        return Response(
            stream_with_context(generate()),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'X-Accel-Buffering': 'no'
            }
        )
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# Summary endpoints

@bp.route('/summaries/<video_id>', methods=['POST'])
def generate_summary(video_id):
    """Generate a summary for a video's transcript using Gemini."""
    try:
        from .gemini_service import generate_summary as gen_summary
        result, error = gen_summary(video_id)
        if error:
            return jsonify({'success': False, 'error': error}), 400
        return jsonify({'success': True, 'transcript': result})
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 500
    except Exception as e:
        return jsonify({'success': False, 'error': f'Summary generation failed: {str(e)}'}), 500


@bp.route('/summaries/<video_id>', methods=['GET'])
def get_summary(video_id):
    """Get the summary for a video."""
    transcript = Transcript.get_by_video_id(video_id)
    if not transcript:
        return jsonify({'success': False, 'error': 'Transcript not found'}), 404
    return jsonify({
        'success': True,
        'summary': transcript.get('summary'),
        'videoId': video_id
    })


@bp.route('/summaries/bulk', methods=['POST'])
def generate_bulk_summaries():
    """Generate summaries for all transcripts that don't have one."""
    try:
        from .gemini_service import generate_summary as gen_summary

        all_transcripts = Transcript.search('')  # Get all transcripts
        to_summarize = []
        for t in all_transcripts:
            full = Transcript.get_by_video_id(t['videoId'])
            if full and not full.get('summary'):
                to_summarize.append(full)

        if not to_summarize:
            return jsonify({
                'success': True,
                'message': 'All transcripts already have summaries',
                'generated': 0
            })

        generated = 0
        errors = []
        for t in to_summarize:
            try:
                result, error = gen_summary(t['videoId'])
                if error:
                    errors.append({'videoId': t['videoId'], 'error': error})
                else:
                    generated += 1
            except Exception as e:
                errors.append({'videoId': t['videoId'], 'error': str(e)})

        return jsonify({
            'success': True,
            'generated': generated,
            'errors': errors,
            'total': len(to_summarize)
        })
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 500
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# Settings endpoints

@bp.route('/settings', methods=['GET'])
def get_settings():
    """Get all application settings and API key configuration status."""
    settings = Setting.get_all()
    return jsonify({
        'success': True,
        'settings': settings,
        'apiKeys': {
            'assemblyai': bool(os.environ.get('ASSEMBLYAI_API_KEY')),
            'google': bool(os.environ.get('GOOGLE_API_KEY'))
        }
    })


@bp.route('/settings', methods=['PUT'])
def update_settings():
    """Update application settings."""
    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'No data provided'}), 400

    allowed_keys = {
        'transcription_provider': ['assemblyai', 'gemini'],
        'gemini_model': ['gemini-2.5-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash-lite']
    }

    for key, value in data.items():
        if key not in allowed_keys:
            return jsonify({'success': False, 'error': f'Unknown setting: {key}'}), 400
        if value not in allowed_keys[key]:
            return jsonify({'success': False, 'error': f'Invalid value for {key}: {value}'}), 400
        Setting.set(key, value)

    return jsonify({'success': True, 'settings': Setting.get_all()})


# Stats endpoint

@bp.route('/stats', methods=['GET'])
def get_stats():
    """Get application statistics."""
    from .database import get_db
    db = get_db()
    total_videos = db.execute('SELECT COUNT(*) as c FROM videos').fetchone()['c']
    total_transcripts = db.execute('SELECT COUNT(*) as c FROM transcripts').fetchone()['c']
    total_summaries = db.execute(
        "SELECT COUNT(*) as c FROM transcripts WHERE summary IS NOT NULL AND summary != ''"
    ).fetchone()['c']
    return jsonify({
        'success': True,
        'totalVideos': total_videos,
        'totalTranscripts': total_transcripts,
        'totalSummaries': total_summaries
    })
