# Base image is pinned by digest, not just by tag. Tags move: `python:3.12-slim`
# points at a different image every time it is rebuilt, so a build that worked
# in January can fail in March with nothing in this repository having changed.
# The digest never moves.
#
# This is the tag that digest corresponded to when it was pinned:
#   python:3.12-slim  (fetched 2026-08-14)
#
# To update it deliberately (for a security fix, say):
#   docker pull python:3.12-slim
#   docker inspect --format='{{index .RepoDigests 0}}' python:3.12-slim
# then paste the new digest here and rebuild. Python 3.12 reaches end of life
# inside this platform's expected lifetime, so this line will need changing --
# see RUNBOOK.md.
FROM python@sha256:dd29372629eeba2dd003fd9e9d35a5b8236c44727875a0364254b5127af88e65

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Installed from the lock file, with hashes, not from requirements.txt.
#
# requirements.txt pins the direct dependencies only, so two builds of the same
# commit could resolve different versions of everything underneath them --
# undermining the base-image digest pinning above, which exists for exactly
# this reason. requirements.lock pins the full tree and --require-hashes means
# a package whose contents changed on the index will not install at all.
#
# Regenerate after editing requirements.txt:
#   pip-compile --generate-hashes --strip-extras \
#       --output-file=requirements.lock requirements.txt
# Run it on the same Python version as this image, or the resolved set can
# differ from what will be installed here.
COPY requirements.txt requirements.lock ./
RUN pip install --no-cache-dir --require-hashes -r requirements.lock

COPY . .

RUN chmod +x /app/entrypoint.sh

# Run as an ordinary user, not root. If the application is ever tricked into
# running something it should not -- through an uploaded file, say -- this is
# what stops it from being able to rewrite the rest of the container.
#
# The uploads directory is created and handed over before the switch, because
# afterwards there are no rights to create it.
RUN useradd --create-home --uid 10001 uep \
    && mkdir -p /data/uploads \
    && chown -R uep:uep /data/uploads /app

USER uep

EXPOSE 8000

# The entrypoint applies Alembic migrations, then starts uvicorn. It fails the
# container rather than serving against a half-migrated database.
ENTRYPOINT ["/app/entrypoint.sh"]
