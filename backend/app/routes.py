from flask import Blueprint, request, jsonify, current_app
from .models import Video, Job, Transcript
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
    """Start a transcription job for a video."""
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
