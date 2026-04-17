"""Abstract base class for brain providers.

Every provider must support: publish, sync, unpublish, status, query.
query() is a generator that yields streaming text chunks for SSE.
"""
from abc import ABC, abstractmethod


class BrainProvider(ABC):
    type: str = ''
    display_name: str = ''

    @abstractmethod
    def is_available(self) -> bool:
        """Return True if this provider is configured (API keys present, etc)."""

    @abstractmethod
    def publish(self, brain, videos) -> dict:
        """Create remote resources and upload all videos.

        Returns a provider_config dict (stored on the brain row).
        `videos` is a list of dicts with keys: video_id, video_title, channel_name,
        video_url, transcript, summary, faq.
        """

    @abstractmethod
    def sync(self, brain, videos) -> dict:
        """Incrementally upload new videos and remove deleted ones.

        `videos` is the current desired full list (same shape as publish()).
        Returns the (possibly updated) provider_config dict.
        """

    @abstractmethod
    def unpublish(self, brain) -> None:
        """Delete all remote resources for this brain."""

    @abstractmethod
    def status(self, brain) -> dict:
        """Return current remote state (file counts, health, etc)."""

    @abstractmethod
    def query(self, brain, question, history=None):
        """Stream response chunks (generator) for a user question.

        history is a list of {'role': 'user'|'assistant', 'content': str}.
        """
