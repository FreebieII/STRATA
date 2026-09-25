# syntax=docker/dockerfile:1
#
# STRATA container image. Normally you don't build this by hand:
#     docker compose up --build
#
# Two targets:
#   runtime  what the services run (the default)
#   test     runtime plus the test tools and tests: docker compose --profile test run --rm tests
#
# Secrets are never copied into the image: .dockerignore excludes .env, and
# docker compose mounts it read-only at /run/secrets/strata_env at run time.

FROM python:3.12-slim AS runtime

# The container user gets your own numeric user ID (1000 on most Linux
# machines), so it can read your .env even when that is `chmod 600`.
ARG UID=1000
ARG GID=1000
# The code version, shown by `strata status` and the API.
ARG GIT_COMMIT=unknown

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    STRATA_GIT_COMMIT=${GIT_COMMIT}

RUN groupadd --gid "${GID}" strata \
 && useradd --uid "${UID}" --gid "${GID}" --create-home --shell /usr/sbin/nologin strata

WORKDIR /app

# Dependencies first, so they're cached between builds. pip refuses any
# package whose hash doesn't match requirements.txt.
COPY requirements.txt ./
RUN pip install --require-hashes -r requirements.txt

COPY pyproject.toml README.md alembic.ini config.yaml ./
COPY strata ./strata
COPY migrations ./migrations
RUN pip install --no-deps -e . \
 && mkdir -p logs data state reports \
 && chown strata:strata logs data state reports

USER strata
EXPOSE 8000
CMD ["strata", "api", "--host", "0.0.0.0"]


FROM runtime AS test

USER root
COPY requirements-dev.txt ./
RUN pip install --require-hashes -r requirements-dev.txt
COPY --chown=strata:strata . .
USER strata
CMD ["pytest", "-q", "-p", "no:cacheprovider"]
