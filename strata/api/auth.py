"""Protecting API endpoints with the ADMIN_API_TOKEN from .env.

Callers send `Authorization: Bearer <token>`. The token is compared in
constant time (so its contents can't be guessed from response times). With no
token configured, protected endpoints refuse everything: failing closed.
Every rejected attempt is logged and stored as a system event.
"""

from __future__ import annotations

import hmac
import logging
from typing import TYPE_CHECKING

from fastapi import HTTPException, Request, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from ..logging_setup import log_event

if TYPE_CHECKING:
    from .app import Services

_bearer = HTTPBearer(auto_error=False, description="The ADMIN_API_TOKEN from .env")


def require_operator(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Security(_bearer),  # noqa: B008
) -> str:
    """Let the request through only with the right token. Returns the caller's role."""
    services: Services = request.app.state.services
    expected = services.api_token
    if expected is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The API token isn't configured: set ADMIN_API_TOKEN in .env.",
        )
    supplied = credentials.credentials if credentials is not None else ""
    if not hmac.compare_digest(supplied.encode(), expected.encode()):
        request_id = getattr(request.state, "request_id", None)
        log_event(
            "auth_failed",
            "rejected a request without a valid API token",
            level=logging.WARNING,
            result=401,
            path=request.url.path,
        )
        services.record_event(
            "auth_failed",
            "rejected a request without a valid API token",
            severity="warning",
            details={"path": request.url.path},
            request_id=request_id,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid API token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return "operator"
