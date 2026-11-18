"""Configuração sem segredos, lida das variáveis HYDROBIM_* a cada app factory."""

import json
import os
from typing import Literal

from pydantic import BaseModel, ConfigDict


class Settings(BaseModel):
    model_config = ConfigDict(frozen=True)

    cors_origins: tuple[str, ...] = ("http://localhost:5180", "http://127.0.0.1:5180")
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"

    @classmethod
    def from_env(cls) -> "Settings":
        values = {}
        if (origins := os.getenv("HYDROBIM_CORS_ORIGINS")) is not None:
            # Array JSON explícito; [] desabilita acesso por outras origens.
            parsed = json.loads(origins)
            if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
                raise ValueError("HYDROBIM_CORS_ORIGINS deve ser um array JSON de strings.")
            values["cors_origins"] = parsed
        if (level := os.getenv("HYDROBIM_LOG_LEVEL")) is not None:
            values["log_level"] = level.upper()
        return cls.model_validate(values)
