import json
import os
import re
import platform

def get_chrome_bookmarks_path():
    """Get the Chrome bookmarks file path based on the operating system."""
    system = platform.system()

    if system == 'Windows':
        local_app_data = os.environ.get('LOCALAPPDATA', '')
        return os.path.join(local_app_data, 'Google', 'Chrome', 'User Data', 'Default', 'Bookmarks')
    elif system == 'Darwin':  # macOS
        home = os.path.expanduser('~')
        return os.path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Bookmarks')
    elif system == 'Linux':
        home = os.path.expanduser('~')
        return os.path.join(home, '.config', 'google-chrome', 'Default', 'Bookmarks')
    else:
        raise OSError(f'Unsupported operating system: {system}')

def extract_youtube_video_id(url):
    """Extract YouTube video ID from various URL formats."""
    patterns = [
        r'(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})',
        r'youtube\.com\/v\/([a-zA-Z0-9_-]{11})',
    ]

    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None

def parse_bookmarks_node(node, youtube_bookmarks):
    """Recursively parse bookmark nodes to find YouTube links."""
    if node.get('type') == 'url':
        url = node.get('url', '')
        if 'youtube.com' in url or 'youtu.be' in url:
            video_id = extract_youtube_video_id(url)
            if video_id:
                youtube_bookmarks.append({
                    'videoId': video_id,
                    'videoTitle': node.get('name', 'Unknown Title'),
                    'videoUrl': url,
                    'channelName': '',
                    'channelUrl': '',
                    'channelId': '',
                    'channelIdSource': 'chrome_bookmark',
                    'scrapedAt': node.get('date_added', '')
                })
    elif node.get('type') == 'folder':
        children = node.get('children', [])
        for child in children:
            parse_bookmarks_node(child, youtube_bookmarks)

def get_chrome_youtube_bookmarks():
    """
    Read Chrome bookmarks file and extract all YouTube video bookmarks.
    Returns a list of bookmark dictionaries.
    """
    bookmarks_path = get_chrome_bookmarks_path()

    if not os.path.exists(bookmarks_path):
        return {
            'success': False,
            'error': f'Chrome bookmarks file not found at: {bookmarks_path}',
            'bookmarks': []
        }

    try:
        with open(bookmarks_path, 'r', encoding='utf-8') as f:
            bookmarks_data = json.load(f)

        youtube_bookmarks = []
        roots = bookmarks_data.get('roots', {})

        for root_name, root_node in roots.items():
            if isinstance(root_node, dict):
                parse_bookmarks_node(root_node, youtube_bookmarks)

        # Remove duplicates based on video ID
        seen_ids = set()
        unique_bookmarks = []
        for bookmark in youtube_bookmarks:
            if bookmark['videoId'] not in seen_ids:
                seen_ids.add(bookmark['videoId'])
                unique_bookmarks.append(bookmark)

        return {
            'success': True,
            'bookmarks': unique_bookmarks,
            'count': len(unique_bookmarks)
        }

    except json.JSONDecodeError as e:
        return {
            'success': False,
            'error': f'Failed to parse bookmarks file: {str(e)}',
            'bookmarks': []
        }
    except PermissionError:
        return {
            'success': False,
            'error': 'Permission denied accessing Chrome bookmarks file',
            'bookmarks': []
        }
    except Exception as e:
        return {
            'success': False,
            'error': f'Error reading bookmarks: {str(e)}',
            'bookmarks': []
        }
