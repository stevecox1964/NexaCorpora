import os
import tempfile
import threading
import logging
import yt_dlp
import assemblyai as aai

from .models import Job, Transcript, Video

logger = logging.getLogger(__name__)


def download_audio(video_url, output_dir):
    """Download audio-only from a YouTube video using yt-dlp."""
    ydl_opts = {
        'format': 'bestaudio/best',
        'outtmpl': os.path.join(output_dir, '%(id)s.%(ext)s'),
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
        'quiet': True,
        'no_warnings': True,
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(video_url, download=True)
        video_id = info['id']
        audio_path = os.path.join(output_dir, f'{video_id}.mp3')
        return audio_path


def transcribe_audio(audio_file_path, api_key):
    """Transcribe an audio file using the AssemblyAI SDK."""
    aai.settings.api_key = api_key
    transcriber = aai.Transcriber()
    transcript = transcriber.transcribe(audio_file_path)

    if transcript.status == aai.TranscriptStatus.error:
        raise Exception(f'AssemblyAI error: {transcript.error}')

    return transcript.text


def run_transcription_job(app, job_id, video_id, api_key):
    """Background thread: download audio, transcribe, store result."""
    tmp_dir = tempfile.mkdtemp(prefix='bm_transcribe_')

    with app.app_context():
        try:
            video = Video.get_by_video_id(video_id)
            if not video or not video.get('videoUrl'):
                Job.update_status(job_id, 'failed', 'Video not found or missing URL')
                return

            # Step 1: Download audio
            Job.update_status(job_id, 'downloading')
            logger.info(f'Downloading audio for {video_id}')
            audio_path = download_audio(video['videoUrl'], tmp_dir)

            # Step 2: Transcribe with AssemblyAI
            Job.update_status(job_id, 'transcribing')
            logger.info(f'Transcribing {video_id} with AssemblyAI')
            text = transcribe_audio(audio_path, api_key)

            if not text:
                Job.update_status(job_id, 'failed', 'Transcription returned empty text')
                return

            # Step 3: Store transcript
            Transcript.create(video_id, text)
            Job.update_status(job_id, 'completed')
            logger.info(f'Transcription complete for {video_id}')

        except Exception as e:
            logger.error(f'Transcription failed for {video_id}: {e}')
            Job.update_status(job_id, 'failed', str(e))

        finally:
            # Clean up temp files
            for f in os.listdir(tmp_dir):
                try:
                    os.remove(os.path.join(tmp_dir, f))
                except OSError:
                    pass
            try:
                os.rmdir(tmp_dir)
            except OSError:
                pass


def start_transcription(app, video_id):
    """Validate and kick off a transcription job in a background thread.
    Returns (job_dict, error_string, http_status_code).
    """
    video = Video.get_by_video_id(video_id)
    if not video:
        return None, 'Video not found', 404

    existing_transcript = Transcript.get_by_video_id(video_id)
    if existing_transcript:
        return None, 'Transcript already exists', 409

    active_job = Job.get_active_by_video_id(video_id, 'transcribe')
    if active_job:
        return active_job, 'Transcription already in progress', 409

    api_key = os.environ.get('ASSEMBLYAI_API_KEY')
    if not api_key:
        return None, 'ASSEMBLYAI_API_KEY not configured', 500

    job = Job.create(video_id, 'transcribe')

    thread = threading.Thread(
        target=run_transcription_job,
        args=(app, job['id'], video_id, api_key),
        daemon=True
    )
    thread.start()

    return job, None, 202
