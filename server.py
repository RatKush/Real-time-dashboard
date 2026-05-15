"""
server.py — Main Flask application entry point
================================================
Responsibilities:
  - Bootstraps the Flask app
  - Registers all API blueprints
  - Serves the single-page frontend at "/"
  - Provides a /health endpoint for uptime checks

Run with:
    python server.py
or with gunicorn:
    gunicorn -w 1 -b 0.0.0.0:5000 server:app
"""

from flask import Flask, render_template

from api.data_api import data_bp          # Excel data blueprint
from api.config_api import config_bp      # User layout/config persistence blueprint
from api.data_api import start_data_loop

# ── App Factory ──────────────────────────────────────────────────────────────
app = Flask(
    __name__,
    template_folder="templates",
    static_folder="static",
)


# ── CORS (manual — no external package needed for an internal tool) ──────────
# Adds permissive CORS headers so the frontend can call the API from any origin.
@app.after_request
def _add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"]  = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
    return response


# ── Register Blueprints ───────────────────────────────────────────────────────
app.register_blueprint(data_bp,   url_prefix="/api/data")
app.register_blueprint(config_bp, url_prefix="/api/config")


# ── Frontend Route ────────────────────────────────────────────────────────────
@app.route("/")
def index():
    """Serve the single-page dashboard."""
    return render_template("index.html")


# ── Health Check ──────────────────────────────────────────────────────────────
@app.route("/health")
def health():
    """Lightweight uptime probe — returns 200 with a JSON body."""
    return {"status": "ok"}, 200


# ── Dev Entry Point ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    start_data_loop()   # ← ADD THIS
    app.run(host="0.0.0.0", port=5001, debug=True, threaded=True)
