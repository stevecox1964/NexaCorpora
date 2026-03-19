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
    """Transcribe an audio file using Gemini multimodal capabilities.
    Returns text with sentence-level timestamps in [M:SS] format."""
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
            "Include timestamps at the start of each sentence in [M:SS] format (e.g. [0:00], [1:23], [12:05]). "
            "For videos over an hour, use [H:MM:SS] format. "
            "Each timestamped sentence should be on its own line, separated by a blank line. "
            "Format example:\n"
            "[0:00] First sentence of the transcript.\n\n"
            "[0:15] Second sentence continues here.\n\n"
            "[0:32] And so on for the rest.\n\n"
            "Be accurate with the timestamps — they should reflect when each sentence "
            "actually starts in the audio. Include all spoken words. "
            "Do not add speaker labels or commentary.",
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

            # Step 3: Store transcript (prepend video URL for reference)
            video_url = video.get('videoUrl', f"https://www.youtube.com/watch?v={video_id}")
            text = f"Video: {video.get('videoTitle', video_id)}\n{video_url}\n\n{text}"
            Transcript.create(video_id, text, provider=provider)
            logger.info(f'Transcription complete for {video_id}')

            # Step 4: Generate summary + FAQ
            Job.update_status(job_id, 'summarizing')
            logger.info(f'Generating summary and FAQ for {video_id}')
            try:
                from .gemini_service import generate_summary, generate_faq
                generate_summary(video_id)
                generate_faq(video_id)
                logger.info(f'Summary and FAQ generated for {video_id}')
            except Exception as sum_err:
                logger.warning(f'Summary/FAQ generation failed for {video_id} (non-fatal): {sum_err}')

            Job.update_status(job_id, 'completed')

            # Step 5: Auto-embed transcript chunks for vector search
            try:
                from .embedding_service import embed_video
                count = embed_video(video_id)
                logger.info(f'Auto-embedded {count} chunks for {video_id}')
            except Exception as embed_err:
                logger.warning(f'Auto-embed failed for {video_id} (non-fatal): {embed_err}')

            # Step 5: Auto-assign to matching brains based on embedding similarity
            try:
                from .brain_service import auto_assign_video
                assigned = auto_assign_video(video_id)
                if assigned:
                    logger.info(f'Auto-assigned {video_id} to brains: {", ".join(assigned)}')
            except Exception as brain_err:
                logger.warning(f'Auto-assign to brains failed for {video_id} (non-fatal): {brain_err}')

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
