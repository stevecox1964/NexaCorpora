"""Brain provider registry.

Each provider implements BrainProvider and represents an external LLM host
where a Brain can be "published" — its videos uploaded and queried remotely.
Keeps the rest of the app vendor-agnostic.
"""
from .base import BrainProvider
from .openai_provider import OpenAIProvider

_REGISTRY = {
    'openai': OpenAIProvider,
}


def get_provider(provider_type):
    cls = _REGISTRY.get(provider_type)
    if cls is None:
        raise ValueError(f'Unknown brain provider: {provider_type}')
    return cls()


def list_providers():
    return [
        {
            'type': key,
            'displayName': cls.display_name,
            'available': cls().is_available(),
        }
        for key, cls in _REGISTRY.items()
    ]


__all__ = ['BrainProvider', 'get_provider', 'list_providers']
