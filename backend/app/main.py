"""FastAPI application entrypoint."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.services import daily_jobs
from app.services.system_status import APP_VERSION
from app.api import api_router
from app.core.bootstrap import init_db
from app.core.config import get_settings
from app.core.csrf import CsrfMiddleware
from app.core.database import engine
from app.core.logging_config import RequestLoggingMiddleware, configure_logging
from app.core.session_renewal import SessionRenewalMiddleware

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
    # UEP-25: System health snapshot and expiring access exceptions, hourly,
    # one pod at a time (services/daily_jobs.py).
    task = None
    if daily_jobs.enabled():
        task = asyncio.create_task(daily_jobs.loop())
    yield
    if task is not None:
        task.cancel()


app = FastAPI(
    title="USO Enterprise Platform API",
    version=APP_VERSION,
    lifespan=lifespan,
)

# Added before CORS so that it wraps it: middleware runs in reverse order of
# registration, so this one sees the request first and the response last, and
# therefore times the whole thing.
# Innermost of the three, so a refused write is still logged and still carries
# CORS headers. See app/core/csrf.py.
app.add_middleware(CsrfMiddleware)
# Slides the session's idle deadline. See app/core/session_renewal.py.
app.add_middleware(SessionRenewalMiddleware)
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
    """Liveness probe. Deliberately touches no database.

    Kubernetes restarts a pod whose liveness probe fails. If this asked the
    database, a database outage would make Kubernetes restart every backend
    pod in a loop -- which fixes nothing and floods the log.
    """
    return {"status": "healthy"}


# The readiness check runs its query on these threads so it can give up after
# READY_TIMEOUT_SECONDS even while a connection attempt is still hanging (an
# unreachable database answers nothing until DB_CONNECT_TIMEOUT_SECONDS). Two
# threads bound how many stuck attempts can pile up; a probe that finds both
# busy waits its turn, times out and reports not-ready, which is the truth.
READY_TIMEOUT_SECONDS = 2.0
_ready_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="uep-ready")


def _database_answers() -> None:
    with engine.connect() as conn:
        if conn.dialect.name == "postgresql":
            conn.execute(text("SET LOCAL statement_timeout = 2000"))
        conn.execute(text("SELECT 1"))


@app.get("/api/health/ready", tags=["health"])
def ready() -> JSONResponse:
    """Readiness probe: may this pod receive traffic?

    Kubernetes stops sending requests to a pod that is not ready, without
    restarting it, and sends them again once it is. Nothing beyond the one
    status line is returned -- the probe needs no authentication, so it must
    say nothing about the database. The backend log has the details.
    """
    try:
        _ready_pool.submit(_database_answers).result(timeout=READY_TIMEOUT_SECONDS)
    except Exception:  # noqa: BLE001 -- any failure, including the timeout, is "not ready"
        return JSONResponse({"status": "database unavailable"}, status_code=503)
    return JSONResponse({"status": "ready"})
