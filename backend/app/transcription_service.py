import os
import tempfile
import threading
import logging
import yt_dlp
import assemblyai as aai

from .models import Job, Transcript, Video, Setting

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


def format_ms_to_timestamp(ms):
    """Convert milliseconds to a human-readable timestamp string."""
    total_seconds = int(ms / 1000)
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    seconds = total_seconds % 60
    if hours > 0:
        return f'{hours}:{minutes:02d}:{seconds:02d}'
    return f'{minutes}:{seconds:02d}'


def transcribe_audio(audio_file_path, api_key):
    """Transcribe an audio file using the AssemblyAI SDK.
    Returns text with sentence-level timestamps in [M:SS] format."""
    aai.settings.api_key = api_key
    transcriber = aai.Transcriber()
    transcript = transcriber.transcribe(audio_file_path)

    if transcript.status == aai.TranscriptStatus.error:
        raise Exception(f'AssemblyAI error: {transcript.error}')

    sentences = transcript.get_sentences()
    if sentences:
        lines = []
        for sentence in sentences:
            ts = format_ms_to_timestamp(sentence.start)
            lines.append(f'[{ts}] {sentence.text}')
        return '\n\n'.join(lines)

    return transcript.text


def transcribe_audio_gemini(audio_file_path, api_key):
    """Transcribe an audio file using Gemini multimodal capabilities."""
    import google.generativeai as genai
    genai.configure(api_key=api_key)

    logger.info(f'Uploading audio to Gemini Files API: {audio_file_path}')
    audio_file = genai.upload_file(audio_file_path, mime_type='audio/mp3')

    model_name = os.environ.get('GEMINI_MODEL', 'gemini-2.5-flash')
    model = genai.GenerativeModel(model_name)

    logger.info(f'Requesting transcription from Gemini model: {model_name}')
    response = model.generate_content(
        [
            "Generate a complete, verbatim transcript of the speech in this audio file. "
            "Include all spoken words accurately. Do not add timestamps, speaker labels, "
            "or commentary — just output the plain text of what was said.",
            audio_file
        ]
    )

    try:
        genai.delete_file(audio_file.name)
    except Exception:
        pass

    return response.text


def run_transcription_job(app, job_id, video_id, api_key, provider='assemblyai'):
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

            # Step 2: Transcribe with selected provider
            Job.update_status(job_id, 'transcribing')
            logger.info(f'Transcribing {video_id} with {provider}')
            if provider == 'gemini':
                text = transcribe_audio_gemini(audio_path, api_key)
            else:
                text = transcribe_audio(audio_path, api_key)

            if not text:
                Job.update_status(job_id, 'failed', 'Transcription returned empty text')
                return

            # Step 3: Store transcript
            Transcript.create(video_id, text)
            Job.update_status(job_id, 'completed')
            logger.info(f'Transcription complete for {video_id}')

            # Step 4: Auto-embed transcript chunks for vector search
            try:
                from .embedding_service import embed_video
                count = embed_video(video_id)
                logger.info(f'Auto-embedded {count} chunks for {video_id}')
            except Exception as embed_err:
                logger.warning(f'Auto-embed failed for {video_id} (non-fatal): {embed_err}')

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


def start_transcription(app, video_id, provider=None, force=False):
    """Validate and kick off a transcription job in a background thread.
    Returns (job_dict, error_string, http_status_code).
    If provider is None, reads from the settings table.
    If force is True, deletes the existing transcript first (retranscribe).
    """
    video = Video.get_by_video_id(video_id)
    if not video:
        return None, 'Video not found', 404

    active_job = Job.get_active_by_video_id(video_id, 'transcribe')
    if active_job:
        return active_job, 'Transcription already in progress', 409

    existing_transcript = Transcript.get_by_video_id(video_id)
    if existing_transcript:
        if force:
            Transcript.delete(video_id)
        else:
            return None, 'Transcript already exists', 409

    if provider is None:
        provider = Setting.get('transcription_provider') or 'assemblyai'

    if provider == 'gemini':
        api_key = os.environ.get('GOOGLE_API_KEY')
        if not api_key:
            return None, 'GOOGLE_API_KEY not configured', 500
    else:
        api_key = os.environ.get('ASSEMBLYAI_API_KEY')
        if not api_key:
            return None, 'ASSEMBLYAI_API_KEY not configured', 500

    job = Job.create(video_id, 'transcribe')

    thread = threading.Thread(
        target=run_transcription_job,
        args=(app, job['id'], video_id, api_key, provider),
        daemon=True
    )
    thread.start()

    return job, None, 202
