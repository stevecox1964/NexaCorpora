"""OpenAI-backed brain provider.

Publishes a brain as a vector store + uploaded files, queried via the
Responses API with the file_search tool. No Assistant object needed.

provider_config shape: {"vector_store_id": "vs_..."}
Per-video uploaded file IDs are tracked in the brain_provider_files table.
"""
import io
import logging
import os
import re
import time

from .base import BrainProvider
from ..models import Brain

logger = logging.getLogger(__name__)

DEFAULT_MODEL = os.environ.get('OPENAI_MODEL', 'gpt-4o-mini')
POLL_INTERVAL_SEC = 2
POLL_TIMEOUT_SEC = 300


def _get_client():
    from openai import OpenAI
    api_key = os.environ.get('OPENAI_API_KEY', '').strip()
    if not api_key:
        raise ValueError('OPENAI_API_KEY is not set')
    return OpenAI(api_key=api_key)


def _sanitize(text, max_len=40):
    slug = re.sub(r'[^a-zA-Z0-9_-]+', '_', (text or '').strip())
    return slug.strip('_')[:max_len] or 'video'


def _build_file_content(video) -> str:
    """Render a video's full context as one Markdown doc."""
    parts = [
        f"# {video.get('video_title') or video.get('video_id')}",
        "",
        f"Channel: {video.get('channel_name') or 'Unknown'}",
        f"URL: {video.get('video_url') or ''}",
        f"VideoID: {video.get('video_id')}",
        "",
    ]
    summary = (video.get('summary') or '').strip()
    if summary:
        parts.extend(["## Summary", "", summary, ""])
    faq = (video.get('faq') or '').strip()
    if faq:
        parts.extend(["## FAQ", "", faq, ""])
    transcript = (video.get('transcript') or '').strip()
    if transcript:
        parts.extend(["## Transcript", "", transcript, ""])
    return "\n".join(parts).strip() + "\n"


def _filename_for(video) -> str:
    title = _sanitize(video.get('video_title') or '')
    vid = video.get('video_id') or 'unknown'
    return f"{title}__{vid}.md"


def _wait_for_vector_store(client, vector_store_id):
    """Block until all files in the store finish indexing."""
    deadline = time.time() + POLL_TIMEOUT_SEC
    while time.time() < deadline:
        vs = client.vector_stores.retrieve(vector_store_id)
        in_progress = getattr(vs.file_counts, 'in_progress', 0)
        if in_progress == 0:
            return vs
        time.sleep(POLL_INTERVAL_SEC)
    raise TimeoutError(f'Vector store {vector_store_id} did not finish indexing in time')


class OpenAIProvider(BrainProvider):
    type = 'openai'
    display_name = 'OpenAI (GPT-4o + file_search)'

    def is_available(self) -> bool:
        return bool(os.environ.get('OPENAI_API_KEY', '').strip())

    # ------------------------------------------------------------------ publish

    def publish(self, brain, videos) -> dict:
        if not videos:
            raise ValueError('Brain has no videos with content to publish')

        client = _get_client()

        vs = client.vector_stores.create(name=f"Brain: {brain['name']}")
        logger.info(f'Created OpenAI vector store {vs.id} for brain {brain["id"]}')

        for video in videos:
            try:
                file_id = self._upload_video(client, vs.id, video)
                Brain.record_provider_file(brain['id'], self.type, video['video_id'], file_id)
            except Exception as e:
                logger.warning(f'Failed to upload video {video.get("video_id")}: {e}')

        _wait_for_vector_store(client, vs.id)

        return {'vector_store_id': vs.id}

    # --------------------------------------------------------------------- sync

    def sync(self, brain, videos) -> dict:
        config = brain.get('providerConfig') or {}
        vs_id = config.get('vector_store_id')
        if not vs_id:
            # Not yet published — treat as first-time publish.
            return self.publish(brain, videos)

        client = _get_client()

        existing = Brain.get_provider_files(brain['id'], self.type)
        current_ids = {v['video_id'] for v in videos}

        # Remove files for videos no longer in the brain
        for video_id, file_id in list(existing.items()):
            if video_id not in current_ids:
                self._remove_file(client, vs_id, file_id)
                Brain.remove_provider_file(brain['id'], self.type, video_id)

        # Upload videos that aren't yet in the store
        to_add = [v for v in videos if v['video_id'] not in existing]
        for video in to_add:
            try:
                file_id = self._upload_video(client, vs_id, video)
                Brain.record_provider_file(brain['id'], self.type, video['video_id'], file_id)
            except Exception as e:
                logger.warning(f'Failed to sync video {video.get("video_id")}: {e}')

        if to_add:
            _wait_for_vector_store(client, vs_id)

        return config

    # ---------------------------------------------------------------- unpublish

    def unpublish(self, brain) -> None:
        config = brain.get('providerConfig') or {}
        vs_id = config.get('vector_store_id')
        if not vs_id:
            return

        client = _get_client()
        existing = Brain.get_provider_files(brain['id'], self.type)

        for video_id, file_id in existing.items():
            try:
                client.files.delete(file_id)
            except Exception as e:
                logger.warning(f'Failed to delete file {file_id}: {e}')

        try:
            client.vector_stores.delete(vs_id)
        except Exception as e:
            logger.warning(f'Failed to delete vector store {vs_id}: {e}')

    # ------------------------------------------------------------------- status

    def status(self, brain) -> dict:
        config = brain.get('providerConfig') or {}
        vs_id = config.get('vector_store_id')
        if not vs_id:
            return {'published': False}

        try:
            client = _get_client()
            vs = client.vector_stores.retrieve(vs_id)
            return {
                'published': True,
                'vectorStoreId': vs.id,
                'name': vs.name,
                'status': vs.status,
                'fileCount': vs.file_counts.completed,
                'inProgress': vs.file_counts.in_progress,
                'failed': vs.file_counts.failed,
                'syncedAt': brain.get('providerSyncedAt'),
            }
        except Exception as e:
            return {'published': True, 'error': str(e), 'vectorStoreId': vs_id}

    # -------------------------------------------------------------------- query

    def query(self, brain, question, history=None):
        config = brain.get('providerConfig') or {}
        vs_id = config.get('vector_store_id')
        if not vs_id:
            raise ValueError('Brain has not been published to OpenAI yet')

        client = _get_client()
        brain_name = brain.get('name', 'this knowledge base')
        brain_desc = brain.get('description') or ''

        instructions = (
            f"You are an expert assistant for the knowledge base \"{brain_name}\". "
            f"{brain_desc} "
            "Answer using only the uploaded documents. "
            "When you cite information, mention the video title it came from. "
            "If the documents do not contain the answer, say so clearly."
        )

        input_items = []
        for msg in (history or []):
            role = 'user' if msg.get('role') == 'user' else 'assistant'
            input_items.append({'role': role, 'content': msg.get('content', '')})
        input_items.append({'role': 'user', 'content': question})

        stream = client.responses.create(
            model=DEFAULT_MODEL,
            input=input_items,
            instructions=instructions,
            tools=[{
                'type': 'file_search',
                'vector_store_ids': [vs_id],
            }],
            stream=True,
        )

        for event in stream:
            etype = getattr(event, 'type', '')
            if etype == 'response.output_text.delta':
                delta = getattr(event, 'delta', '')
                if delta:
                    yield delta
            elif etype == 'response.error':
                err = getattr(event, 'error', None)
                raise RuntimeError(str(err) if err else 'OpenAI stream error')

    # ---------------------------------------------------------------- internals

    def _upload_video(self, client, vs_id, video) -> str:
        content = _build_file_content(video).encode('utf-8')
        filename = _filename_for(video)

        buf = io.BytesIO(content)
        buf.name = filename
        uploaded = client.files.create(file=buf, purpose='assistants')
        client.vector_stores.files.create(vector_store_id=vs_id, file_id=uploaded.id)
        return uploaded.id

    def _remove_file(self, client, vs_id, file_id):
        try:
            client.vector_stores.files.delete(vector_store_id=vs_id, file_id=file_id)
        except Exception as e:
            logger.warning(f'Failed to detach file {file_id} from store: {e}')
        try:
            client.files.delete(file_id)
        except Exception as e:
            logger.warning(f'Failed to delete file {file_id}: {e}')
