"""Logging in and out of the dashboard.

    POST /auth/login    username + password -> session cookie
    POST /auth/logout   end the session
    GET  /auth/me       who am I? (session or token)

Accounts are created on the machine with `strata operator create`; there is
no way to create one over the network.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from ..auth.sessions import SESSION_COOKIE, SESSION_TTL_S
from ..logging_setup import log_event
from .auth import Caller, client_address, require_dashboard_header, require_operator, safe_username
from .schemas import Identity, LoginRequest

if TYPE_CHECKING:
    from .app import Services

router = APIRouter(prefix="/auth", tags=["auth"])


def _services(request: Request) -> Services:
    services: Services = request.app.state.services
    return services


@router.post(
    "/login",
    response_model=Identity,
    dependencies=[Depends(require_dashboard_header)],
    responses={
        401: {"description": "wrong username or password"},
        429: {"description": "too many failures"},
    },
)
def login(body: LoginRequest, request: Request, response: Response) -> Identity:
    services = _services(request)
    request_id = getattr(request.state, "request_id", None)
    address = client_address(request)
    typed_name = safe_username(body.username)

    wait = services.login_limiter.seconds_blocked(typed_name, address)
    if wait:
        log_event(
            "login_blocked",
            f"login for {typed_name!r} refused: too many failures",
            level=logging.WARNING,
            result=429,
            address=address,
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many failed logins. Try again in {wait // 60 + 1} minute(s).",
            headers={"Retry-After": str(wait)},
        )

    username = services.store.authenticate(body.username, body.password)
    if username is None:
        services.login_limiter.record_failure(typed_name, address)
        log_event(
            "login_failed",
            f"failed login for {typed_name!r}",
            level=logging.WARNING,
            result=401,
            address=address,
        )
        services.store.record_event(
            "login_failed",
            f"failed login for {typed_name!r}",
            severity="warning",
            details={"username": typed_name, "address": address},
            request_id=request_id,
        )
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Wrong username or password.")

    services.login_limiter.record_success(username)
    session_id = services.sessions.create(username)
    info = services.sessions.get(session_id)
    services.store.record_audit(
        actor=username,
        action="login",
        target_type="operator",
        target_id=username,
        details={"address": address},
        request_id=request_id,
    )
    log_event("login", f"{username} logged in", address=address)
    response.set_cookie(
        SESSION_COOKIE,
        session_id,
        max_age=SESSION_TTL_S,
        httponly=True,
        secure=True,
        samesite="strict",
        path="/",
    )
    return Identity(
        via="session", username=username, session_expires_at=info.expires_at if info else None
    )


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_dashboard_header)],
)
def logout(request: Request, response: Response) -> None:
    services = _services(request)
    session_id = request.cookies.get(SESSION_COOKIE)
    if session_id:
        info = services.sessions.get(session_id)
        services.sessions.end(session_id)
        if info is not None:
            try:
                services.store.record_audit(
                    actor=info.username,
                    action="logout",
                    target_type="operator",
                    target_id=info.username,
                    request_id=getattr(request.state, "request_id", None),
                )
            except Exception:  # logging out must always work
                log_event("logout", f"{info.username} logged out (audit entry failed)")
    response.delete_cookie(SESSION_COOKIE, path="/", secure=True, httponly=True, samesite="strict")


@router.get("/me", response_model=Identity)
def me(caller: Caller = Depends(require_operator)) -> Identity:  # noqa: B008
    return Identity(
        via=caller.via,
        username=caller.username,
        session_expires_at=caller.session.expires_at if caller.session else None,
    )
