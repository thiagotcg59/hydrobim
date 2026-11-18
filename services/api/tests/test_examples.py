import json
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
EXAMPLES = sorted((REPO_ROOT / "examples").glob("*.json"))


@pytest.mark.parametrize(
    "example",
    EXAMPLES or [pytest.param(None, marks=pytest.mark.skip(reason="Nenhum JSON em examples/."))],
    ids=[path.name for path in EXAMPLES] or ["sem-exemplos"],
)
def test_repository_example_validates(client, example):
    document = json.loads(example.read_text(encoding="utf-8"))
    response = client.post("/api/v1/projects/validate", json=document)
    assert response.status_code == 200, f"{example.name}: {response.text}"
    assert response.json()["valid"] is True, f"{example.name}: {response.json()}"
