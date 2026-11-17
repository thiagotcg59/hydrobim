import json
import logging

import pytest
from fastapi.testclient import TestClient

from hydrobim_api.config import Settings
from hydrobim_api.logging_config import JsonFormatter, configure_logging
from hydrobim_api.main import create_app


def test_environment_settings_are_read_for_each_app(monkeypatch):
    monkeypatch.setenv("HYDROBIM_CORS_ORIGINS", '["https://editor.example"]')
    monkeypatch.setenv("HYDROBIM_LOG_LEVEL", "warning")
    settings = Settings.from_env()
    assert settings.cors_origins == ("https://editor.example",)
    assert settings.log_level == "WARNING"
    with TestClient(create_app()) as client:
        response = client.get("/health", headers={"Origin": "https://editor.example"})
        assert response.headers["access-control-allow-origin"] == "https://editor.example"
    monkeypatch.setenv("HYDROBIM_CORS_ORIGINS", "[]")
    assert Settings.from_env().cors_origins == ()


@pytest.mark.parametrize("origins", ['"http://localhost:5173"', "[1]", "{", "null"])
def test_invalid_cors_configuration_fails_at_startup(monkeypatch, origins):
    monkeypatch.setenv("HYDROBIM_CORS_ORIGINS", origins)
    with pytest.raises(ValueError):
        create_app()


def test_json_logging_is_structured_and_configuration_is_idempotent():
    configure_logging("INFO")
    logger = logging.getLogger("hydrobim_api")
    handlers = len(logger.handlers)
    configure_logging("INFO")
    assert len(logger.handlers) == handlers
    record = logging.LogRecord("hydrobim_api", logging.INFO, __file__, 1, "validação", (), None)
    record.element_count = 6
    output = json.loads(JsonFormatter().format(record))
    assert output["message"] == "validação"
    assert output["element_count"] == 6
    assert output["level"] == "INFO"
    assert output["timestamp"]
