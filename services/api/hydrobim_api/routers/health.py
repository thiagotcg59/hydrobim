"""Informações de saúde e capacidades efetivamente implementadas."""

from fastapi import APIRouter

from hydrobim_api import __version__
from hydrobim_api.models.project import SCHEMA_VERSION

router = APIRouter(tags=["service"])


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "hydrobim-api", "version": __version__}


@router.get("/api/v1/capabilities")
def capabilities() -> dict[str, int | bool]:
    return {"projectSchemaVersion": SCHEMA_VERSION, "validation": True, "ifcExport": False}
