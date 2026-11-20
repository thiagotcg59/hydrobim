import json
from importlib.metadata import version

import pytest
from fastapi.testclient import TestClient

from hydrobim_api.config import Settings
from hydrobim_api.main import create_app
from hydrobim_api.routers import projects

VALIDATE_URL = "/api/v1/projects/validate"


def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "hydrobim-api",
        "version": version("hydrobim-api"),
    }


def test_capabilities(client):
    response = client.get("/api/v1/capabilities")
    assert response.status_code == 200
    assert response.json() == {
        "projectSchemaVersion": 13,
        "validation": True,
        "ifcExport": False,
        "ifcVerification": True,
    }
    assert response.json()["ifcExport"] is False


def test_valid_project(client, project_document):
    response = client.post(VALIDATE_URL, json=project_document)
    assert response.status_code == 200
    assert response.json() == {"valid": True, "elementCount": 6, "connectionCount": 5, "issues": []}


@pytest.mark.parametrize("case", ["format", "missing", "diameter", "kind"])
def test_schema_errors_return_standard_422(client, project_document, case):
    if case == "format":
        project_document["format"] = "other-format"
    elif case == "missing":
        del project_document["elements"][0]["start"]
    elif case == "diameter":
        project_document["elements"][0]["spec"]["outerDiameter"] = -0.025
    else:
        project_document["elements"][0]["kind"] = "pump"
    response = client.post(VALIDATE_URL, json=project_document)
    assert response.status_code == 422
    errors = response.json()["detail"]
    assert isinstance(errors, list) and errors
    assert {"loc", "msg", "type"} <= errors[0].keys()
    assert errors[0]["loc"][0] == "body"


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -float("inf")])
@pytest.mark.parametrize("location", ["coordinate", "diameter", "property", "revision", "version"])
def test_nonfinite_numbers_return_422(client, project_document, value, location):
    element = project_document["elements"][0]
    if location == "coordinate":
        element["start"]["x"] = value
    elif location == "diameter":
        element["spec"]["outerDiameter"] = value
    elif location == "property":
        element["properties"]["invalid"] = value
    elif location == "revision":
        element["meta"]["revision"] = value
    else:
        project_document["schemaVersion"] = value
    # httpx bloqueia NaN em json=; enviar o corpo cru exercita a defesa HTTP real.
    response = client.post(
        VALIDATE_URL,
        content=json.dumps(project_document),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)
    json.dumps(response.json(), allow_nan=False)


@pytest.mark.parametrize("body", ["{", "null", "[]", '"projeto"'])
def test_invalid_json_document(client, body):
    response = client.post(VALIDATE_URL, content=body, headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)


@pytest.mark.parametrize("origin", ["http://localhost:5180", "http://127.0.0.1:5180"])
def test_cors_default_origins(client, origin):
    response = client.options(
        VALIDATE_URL,
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


def test_cors_rejects_unknown_origin(client):
    response = client.get("/health", headers={"Origin": "https://unknown.example"})
    assert "access-control-allow-origin" not in response.headers


def test_unexpected_error_hides_traceback(monkeypatch, project_document):
    def fail_validation(_project):
        raise RuntimeError("internal diagnostic never returned to the client")

    monkeypatch.setattr(projects, "validate_project", fail_validation)
    with TestClient(create_app(Settings()), raise_server_exceptions=False) as client:
        response = client.post(VALIDATE_URL, json=project_document)
    assert response.status_code == 500
    assert response.json() == {"detail": "Erro interno do servidor."}


def test_openapi_exposes_discriminator_and_camel_case(client):
    response = client.get("/openapi.json")
    assert response.status_code == 200
    schemas = response.json()["components"]["schemas"]
    project = schemas["Project"]["properties"]
    assert "schemaVersion" in project
    assert project["elements"]["items"]["discriminator"]["propertyName"] == "kind"
    assert "outletSpec" in schemas["Reducer"]["properties"]
