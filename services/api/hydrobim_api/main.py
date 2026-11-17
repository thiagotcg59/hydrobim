"""Application factory e entrada ASGI para uvicorn."""

import logging
import math
from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from hydrobim_api import __version__
from hydrobim_api.config import Settings
from hydrobim_api.logging_config import configure_logging
from hydrobim_api.routers import health, projects

logger = logging.getLogger(__name__)


def _json_safe(value: Any) -> Any:
    """Mantém o corpo 422 padrão mesmo quando input contém NaN/Infinity."""
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    return value


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings if settings is not None else Settings.from_env()
    configure_logging(settings.log_level)
    application = FastAPI(title="HydroBIM API", version=__version__, debug=False)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    @application.exception_handler(RequestValidationError)
    async def schema_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422, content={"detail": _json_safe(jsonable_encoder(exc.errors()))}
        )

    @application.exception_handler(Exception)
    async def unexpected_error_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.error(
            "unhandled_request_error",
            extra={"method": request.method, "path": request.url.path, "status_code": 500},
            exc_info=(type(exc), exc, exc.__traceback__),
        )
        return JSONResponse(status_code=500, content={"detail": "Erro interno do servidor."})

    application.include_router(health.router)
    application.include_router(projects.router)
    return application


app = create_app()
