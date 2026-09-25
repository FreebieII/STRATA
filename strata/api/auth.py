"""Who may call the protected API endpoints.

Two ways in:

* Scripts and tools send `Authorization: Bearer <ADMIN_API_TOKEN>`. The token
  is compared in constant time. With no token configured, token requests are
  refused (fail closed).
* People use the dashboard. After logging in (see auth_routes.py) the browser
  holds a session cookie that JavaScript can't read. Every request is checked
  against the session store, and against the account itself: a disabled
  account, or one whose password changed after the session began, is refused.
  Requests that change anything must also carry the X-Strata-Dashboard header,
  which a page on another site can't add, so it can't act on your behalf.

Every rejected token is logged and stored as a system event.
"""

from __future__ import annotations

import hmac
import ipaddress
import logging
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

from fastapi import HTTPException, Request, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from ..auth.sessions import SESSION_COOKIE, SessionInfo
from ..logging_setup import log_event

if TYPE_CHECKING:
    from .app import Services

DASHBOARD_HEADER = "X-Strata-Dashboard"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

_bearer = HTTPBearer(auto_error=False, description="The ADMIN_API_TOKEN from .env")
_NOT_A_NAME = re.compile(r"[^a-z0-9._-]")


@dataclass(frozen=True)
class Caller:
    via: Literal["token", "session"]
    username: str | None = None
    session: SessionInfo | None = None


def require_operator(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Security(_bearer),  # noqa: B008
) -> Caller:
    """Let the request through only with a valid token or dashboard session."""
    services: Services = request.app.state.services
    if credentials is not None or "authorization" in request.headers:
        return _check_token(request, services, credentials)
    session_id = request.cookies.get(SESSION_COOKIE)
    if session_id:
        return _check_session(request, services, session_id)
    raise _unauthorised("Log in, or send the API token.")


def require_dashboard_header(request: Request) -> None:
    if request.headers.get(DASHBOARD_HEADER) != "1":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Requests that change something need the {DASHBOARD_HEADER} header.",
        )


def client_address(request: Request) -> str:
    """The caller's address. Behind the dashboard's nginx this is the X-Real-IP it
    sets (replacing anything the browser sent); otherwise the direct peer."""
    forwarded = request.headers.get("x-real-ip", "").strip()
    try:
        return str(ipaddress.ip_address(forwarded))
    except ValueError:
        return request.client.host if request.client else "unknown"


def safe_username(text: str) -> str:
    """A typed username made safe to log: lowercase, plain characters only, short."""
    return _NOT_A_NAME.sub("?", text.strip().lower())[:64] or "?"


def _check_token(
    request: Request, services: Services, credentials: HTTPAuthorizationCredentials | None
) -> Caller:
    expected = services.api_token
    if expected is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The API token isn't configured: set ADMIN_API_TOKEN in .env.",
        )
    supplied = credentials.credentials if credentials is not None else ""
    if not hmac.compare_digest(supplied.encode(), expected.encode()):
        log_event(
            "auth_failed",
            "rejected a request without a valid API token",
            level=logging.WARNING,
            result=401,
            path=request.url.path,
        )
        services.store.record_event(
            "auth_failed",
            "rejected a request without a valid API token",
            severity="warning",
            details={"path": request.url.path, "address": client_address(request)},
            request_id=getattr(request.state, "request_id", None),
        )
        raise _unauthorised("Missing or invalid API token.")
    return Caller(via="token")


def _check_session(request: Request, services: Services, session_id: str) -> Caller:
    info = services.sessions.get(session_id)
    if info is None:
        raise _unauthorised("Your session has ended. Log in again.")
    valid_since = services.store.operator_valid_since(info.username)
    if valid_since is None or info.created_at < valid_since:
        # Account disabled, removed, or its password changed after this session began.
        services.sessions.end(session_id)
        raise _unauthorised("Your session has ended. Log in again.")
    if request.method not in SAFE_METHODS:
        require_dashboard_header(request)
    return Caller(via="session", username=info.username, session=info)


def _unauthorised(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )
