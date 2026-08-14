"""FastAPI application entrypoint."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import api_router
from app.core.bootstrap import init_db
from app.core.config import get_settings
from app.core.logging_config import RequestLoggingMiddleware, configure_logging

settings = get_settings()

# Before anything else, so that startup problems are logged in the same format
# as everything that follows.
configure_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Seed baseline reference data on startup.

    This deliberately does not create or alter any table. The schema is owned by
    Alembic and applied by ``entrypoint.sh`` before this process starts, so that
    a failed migration stops the deploy instead of going live half-applied.
    """
    init_db()
    yield


app = FastAPI(
    title="USO Enterprise Platform API",
    version="1.0.0",
    lifespan=lifespan,
)

# Added before CORS so that it wraps it: middleware runs in reverse order of
# registration, so this one sees the request first and the response last, and
# therefore times the whole thing.
app.add_middleware(RequestLoggingMiddleware)

# The origin list is validated at startup (app/core/config.py): in production it
# must name real origins, because "*" together with allow_credentials makes
# Starlette echo back whichever origin asked, which is not a restriction at all.
# In production the frontend is same-origin behind nginx, so this list normally
# holds just the one public address.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/api/health", tags=["health"])
def health() -> dict[str, str]:
    """Simple liveness probe."""
    return {"status": "healthy"}
