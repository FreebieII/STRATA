"""The HTTP API (FastAPI).

    app.py       builds the application: services, request IDs, request logging
    auth.py      the bearer-token check for protected endpoints
    routes.py    the endpoints
    schemas.py   the shapes of the responses

Only /health and /health/ready are public. Everything else needs the
ADMIN_API_TOKEN from .env, and refuses every request if no token is set.
"""
