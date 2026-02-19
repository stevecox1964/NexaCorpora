import os
from flask import Flask, send_from_directory
from flask_cors import CORS

def create_app():
    app = Flask(__name__)
    CORS(app)

    app.config['DATABASE'] = '/app/data/bookmarks.db'

    from . import database
    database.init_db(app)

    from . import routes
    app.register_blueprint(routes.bp)

    # Serve built React SPA when static build is present (e.g. in Docker)
    static_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'static')
    if os.path.isdir(static_dir):
        app.static_folder = static_dir
        app.static_url_path = ''

        @app.route('/', defaults={'path': ''})
        @app.route('/<path:path>')
        def serve_spa(path):
            if path and os.path.exists(os.path.join(app.static_folder, path)):
                return send_from_directory(app.static_folder, path)
            return send_from_directory(app.static_folder, 'index.html')

    return app
