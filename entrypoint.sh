#!/bin/bash
# Start both Flask (gunicorn) and MCP server in a single container

# Start MCP server in background
MCP_HOST=0.0.0.0 MCP_PORT=8001 python mcp_server.py --transport sse &

# Start Flask via gunicorn (foreground — container lives as long as this runs)
exec gunicorn --bind 0.0.0.0:5000 --workers 2 --threads 4 --timeout 120 run:app
