import sqlite3
import os
from flask import g, current_app

def get_db():
    if 'db' not in g:
        db_path = current_app.config['DATABASE']
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        g.db = sqlite3.connect(db_path)
        g.db.row_factory = sqlite3.Row
    return g.db

def close_db(e=None):
    db = g.pop('db', None)
    if db is not None:
        db.close()

def init_db(app):
    app.teardown_appcontext(close_db)

    with app.app_context():
        db = get_db()
        db.execute('''
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

        db.execute('''
            CREATE TABLE IF NOT EXISTS transcripts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                video_id TEXT NOT NULL,
                content TEXT,
                indexed_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (video_id) REFERENCES videos (video_id) ON DELETE CASCADE
            )
        ''')

        db.execute('''
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                video_id TEXT NOT NULL,
                job_type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                error_message TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                completed_at TEXT,
                FOREIGN KEY (video_id) REFERENCES videos (video_id) ON DELETE CASCADE
            )
        ''')

        # Create indexes for better query performance
        db.execute('CREATE INDEX IF NOT EXISTS idx_videos_video_id ON videos(video_id)')
        db.execute('CREATE INDEX IF NOT EXISTS idx_videos_scraped_at ON videos(scraped_at DESC)')
        db.execute('CREATE INDEX IF NOT EXISTS idx_videos_channel_id ON videos(channel_id)')
        db.execute('CREATE INDEX IF NOT EXISTS idx_transcripts_video_id ON transcripts(video_id)')
        db.execute('CREATE INDEX IF NOT EXISTS idx_jobs_video_id ON jobs(video_id)')
        db.execute('CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)')

        db.commit()
