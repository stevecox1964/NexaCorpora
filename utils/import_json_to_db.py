#!/usr/bin/env python3
"""
Utility script to import YouTube video JSON files into the SQLite database.

This script traverses a directory containing channel folders with JSON files
and imports them into the BookMarkManager database.

Usage:
    python import_json_to_db.py --test           # Dry run - shows what would happen
    python import_json_to_db.py --import         # Actually import to database
    python import_json_to_db.py --source PATH    # Specify custom source directory
"""

import os
import sys
import json
import sqlite3
import argparse
from datetime import datetime
from pathlib import Path

# Default paths
DEFAULT_SOURCE_DIR = r"C:\Users\user\Downloads\you_tube_summaries"
DEFAULT_DB_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "backend", "data", "bookmarks.db"
)


def get_db_connection(db_path):
    """Create database connection and ensure tables exist."""
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    # Ensure tables exist
    conn.execute('''
        CREATE TABLE IF NOT EXISTS videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            channel_id TEXT,
            channel_id_source TEXT,
            channel_name TEXT,
            channel_url TEXT,
            scraped_at TEXT,
            video_id TEXT UNIQUE NOT NULL,
            video_title TEXT NOT NULL,
            video_url TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    return conn


def find_json_files(source_dir):
    """
    Traverse source directory and find all JSON files.

    Directory structure expected:
    source_dir/
        UCvBy3qcISSOcrbqPhqmG4Xw/  (channel ID folder)
            video_title_videoId.json
            ...
        @channelHandle/           (channel handle folder)
            video_title_videoId.json
            ...

    Returns list of (folder_name, file_path) tuples.
    """
    json_files = []
    source_path = Path(source_dir)

    if not source_path.exists():
        print(f"Error: Source directory does not exist: {source_dir}")
        return json_files

    for folder in source_path.iterdir():
        if folder.is_dir():
            folder_name = folder.name
            for json_file in folder.glob("*.json"):
                json_files.append((folder_name, json_file))

    return json_files


def parse_json_file(file_path):
    """
    Parse a JSON file and extract video data.
    Returns dict with video data or None if invalid.
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        # Validate required fields
        required_fields = ['videoId', 'videoTitle']
        for field in required_fields:
            if field not in data or not data[field]:
                print(f"  Warning: Missing required field '{field}' in {file_path}")
                return None

        return {
            'channelId': data.get('channelId', ''),
            'channelIdSource': data.get('channelIdSource', ''),
            'channelName': data.get('channelName', ''),
            'channelUrl': data.get('channelUrl', ''),
            'scrapedAt': data.get('scrapedAt', datetime.utcnow().isoformat()),
            'videoId': data['videoId'],
            'videoTitle': data['videoTitle'],
            'videoUrl': data.get('videoUrl', f"https://www.youtube.com/watch?v={data['videoId']}")
        }
    except json.JSONDecodeError as e:
        print(f"  Error: Invalid JSON in {file_path}: {e}")
        return None
    except Exception as e:
        print(f"  Error reading {file_path}: {e}")
        return None


def check_video_exists(conn, video_id):
    """Check if a video already exists in the database."""
    cursor = conn.execute(
        "SELECT id FROM videos WHERE video_id = ?",
        (video_id,)
    )
    return cursor.fetchone() is not None


def insert_video(conn, video_data):
    """Insert a video into the database."""
    conn.execute('''
        INSERT INTO videos (
            channel_id, channel_id_source, channel_name, channel_url,
            scraped_at, video_id, video_title, video_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        video_data['channelId'],
        video_data['channelIdSource'],
        video_data['channelName'],
        video_data['channelUrl'],
        video_data['scrapedAt'],
        video_data['videoId'],
        video_data['videoTitle'],
        video_data['videoUrl']
    ))


def run_test(source_dir, db_path):
    """
    Test mode - shows what would happen without modifying the database.
    """
    print("=" * 60)
    print("TEST MODE - No changes will be made to the database")
    print("=" * 60)
    print(f"\nSource directory: {source_dir}")
    print(f"Database path: {db_path}")

    # Find all JSON files
    print("\n[1] Scanning for JSON files...")
    json_files = find_json_files(source_dir)
    print(f"    Found {len(json_files)} JSON files")

    if not json_files:
        print("\nNo JSON files found. Nothing to import.")
        return

    # Group by folder
    folders = {}
    for folder_name, file_path in json_files:
        if folder_name not in folders:
            folders[folder_name] = []
        folders[folder_name].append(file_path)

    print(f"    Across {len(folders)} channel folders:")
    for folder_name, files in sorted(folders.items()):
        print(f"      - {folder_name}: {len(files)} files")

    # Check database connection
    print("\n[2] Checking database connection...")
    try:
        conn = get_db_connection(db_path)
        cursor = conn.execute("SELECT COUNT(*) FROM videos")
        existing_count = cursor.fetchone()[0]
        print(f"    Database connected. Currently has {existing_count} videos.")
        conn.close()
    except Exception as e:
        print(f"    Error connecting to database: {e}")
        return

    # Parse and validate files
    print("\n[3] Parsing JSON files...")
    valid_videos = []
    invalid_files = []

    for folder_name, file_path in json_files:
        video_data = parse_json_file(file_path)
        if video_data:
            valid_videos.append((folder_name, file_path, video_data))
        else:
            invalid_files.append(file_path)

    print(f"    Valid: {len(valid_videos)}")
    print(f"    Invalid: {len(invalid_files)}")

    if invalid_files:
        print("\n    Invalid files:")
        for f in invalid_files[:10]:  # Show first 10
            print(f"      - {f}")
        if len(invalid_files) > 10:
            print(f"      ... and {len(invalid_files) - 10} more")

    # Check for duplicates
    print("\n[4] Checking for duplicates...")
    conn = get_db_connection(db_path)
    would_import = []
    would_skip = []

    for folder_name, file_path, video_data in valid_videos:
        if check_video_exists(conn, video_data['videoId']):
            would_skip.append((folder_name, video_data))
        else:
            would_import.append((folder_name, video_data))

    conn.close()

    print(f"    Would import: {len(would_import)}")
    print(f"    Would skip (already exists): {len(would_skip)}")

    # Show sample of what would be imported
    if would_import:
        print("\n[5] Sample of videos that would be imported:")
        for folder_name, video_data in would_import[:5]:
            print(f"      [{folder_name}]")
            print(f"        Title: {video_data['videoTitle'][:60]}...")
            print(f"        ID: {video_data['videoId']}")
            print(f"        Channel: {video_data['channelName']}")
        if len(would_import) > 5:
            print(f"      ... and {len(would_import) - 5} more")

    print("\n" + "=" * 60)
    print("TEST COMPLETE - Run with --import to actually import data")
    print("=" * 60)


def run_import(source_dir, db_path):
    """
    Import mode - actually imports data into the database.
    """
    print("=" * 60)
    print("IMPORT MODE - Importing data to database")
    print("=" * 60)
    print(f"\nSource directory: {source_dir}")
    print(f"Database path: {db_path}")

    # Find all JSON files
    print("\n[1] Scanning for JSON files...")
    json_files = find_json_files(source_dir)
    print(f"    Found {len(json_files)} JSON files")

    if not json_files:
        print("\nNo JSON files found. Nothing to import.")
        return

    # Connect to database
    print("\n[2] Connecting to database...")
    conn = get_db_connection(db_path)
    cursor = conn.execute("SELECT COUNT(*) FROM videos")
    existing_count = cursor.fetchone()[0]
    print(f"    Connected. Starting with {existing_count} videos.")

    # Import files
    print("\n[3] Importing videos...")
    imported = 0
    skipped = 0
    errors = 0

    for i, (folder_name, file_path) in enumerate(json_files):
        video_data = parse_json_file(file_path)

        if not video_data:
            errors += 1
            continue

        if check_video_exists(conn, video_data['videoId']):
            skipped += 1
            continue

        try:
            insert_video(conn, video_data)
            imported += 1

            # Progress indicator every 50 files
            if imported % 50 == 0:
                print(f"    Imported {imported} videos...")
                conn.commit()  # Commit in batches
        except Exception as e:
            print(f"    Error importing {video_data['videoId']}: {e}")
            errors += 1

    # Final commit
    conn.commit()

    # Final count
    cursor = conn.execute("SELECT COUNT(*) FROM videos")
    final_count = cursor.fetchone()[0]
    conn.close()

    print("\n" + "=" * 60)
    print("IMPORT COMPLETE")
    print("=" * 60)
    print(f"\nResults:")
    print(f"  Imported: {imported}")
    print(f"  Skipped (duplicates): {skipped}")
    print(f"  Errors: {errors}")
    print(f"\nDatabase now has {final_count} videos (was {existing_count})")


def main():
    parser = argparse.ArgumentParser(
        description="Import YouTube video JSON files into BookMarkManager database"
    )

    parser.add_argument(
        '--test',
        action='store_true',
        help='Test mode - show what would happen without making changes'
    )

    parser.add_argument(
        '--import',
        dest='do_import',
        action='store_true',
        help='Import mode - actually import data to database'
    )

    parser.add_argument(
        '--source',
        type=str,
        default=DEFAULT_SOURCE_DIR,
        help=f'Source directory containing channel folders (default: {DEFAULT_SOURCE_DIR})'
    )

    parser.add_argument(
        '--db',
        type=str,
        default=DEFAULT_DB_PATH,
        help=f'Database file path (default: {DEFAULT_DB_PATH})'
    )

    args = parser.parse_args()

    if not args.test and not args.do_import:
        print("Please specify --test or --import mode")
        print("\nExamples:")
        print("  python import_json_to_db.py --test")
        print("  python import_json_to_db.py --import")
        print("  python import_json_to_db.py --test --source /path/to/jsons")
        parser.print_help()
        sys.exit(1)

    if args.test:
        run_test(args.source, args.db)
    elif args.do_import:
        run_import(args.source, args.db)


if __name__ == '__main__':
    main()
