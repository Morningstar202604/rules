---
name: docker
description: Use when writing or debugging Dockerfiles, docker-compose services, container networking, image size, or build caching.
---

# Docker

## Dockerfiles
- Pin base image tags; never `latest` in production.
- Multi-stage builds: build in a heavy stage, copy artifacts into a slim runtime stage.
- Order layers from least to most frequently changing to maximize cache hits.
- Copy lockfiles before source; run dependency install before `COPY . .`.
- Run as a non-root user. Use `--no-install-recommends`, clean package caches in the same layer.

## Compose
- Declare healthchecks and `depends_on: condition: service_healthy`.
- Named volumes for persistent data; bind mounts only for development.
- Never bake secrets into images — use env files or secrets mounts.
