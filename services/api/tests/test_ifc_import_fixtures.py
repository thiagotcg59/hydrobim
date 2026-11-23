"""Arquivos IFC de teste da importação (`tests/fixtures/ifc-import`).

O editor lê esses arquivos com o web-ifc; aqui o IfcOpenShell — implementação independente —
confere que cada arquivo é um IFC válido do esquema declarado e que os valores de conferência
gravados (`*.expected.json`, usados por `tests/integration/ifcImport.test.ts`) continuam sendo
exatamente o que ele lê do arquivo. Também valida, pelo contrato do backend, um projeto com
modelo importado.
"""

import importlib.util
import json
import sys
from pathlib import Path

import ifcopenshell
import ifcopenshell.validate
import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES = REPO_ROOT / "tests" / "fixtures" / "ifc-import"
SCRIPT = REPO_ROOT / "services" / "api" / "scripts" / "make_ifc_import_fixtures.py"

_spec = importlib.util.spec_from_file_location("make_ifc_import_fixtures", SCRIPT)
assert _spec and _spec.loader
generator = importlib.util.module_from_spec(_spec)
# As dataclasses do script consultam o módulo pelo nome durante a carga.
sys.modules[_spec.name] = generator
_spec.loader.exec_module(generator)

VARIANTS = {variant.file_name: variant for variant in generator.VARIANTS}


@pytest.mark.parametrize("file_name", sorted(VARIANTS))
def test_fixture_is_valid_ifc_of_declared_schema(file_name):
    variant = VARIANTS[file_name]
    model = ifcopenshell.open(str(FIXTURES / file_name))
    assert model.schema_identifier == variant.schema
    logger = ifcopenshell.validate.json_logger()
    ifcopenshell.validate.validate(model, logger)
    assert logger.statements == [], logger.statements[:3]


@pytest.mark.parametrize("file_name", sorted(VARIANTS))
def test_expected_values_match_ifcopenshell(file_name):
    path = FIXTURES / file_name
    recorded = json.loads((FIXTURES / f"{path.stem}.expected.json").read_text(encoding="utf-8"))
    current = json.loads(json.dumps(generator.expected_of(path)))
    assert current["schema"] == recorded["schema"]
    assert current["products"].keys() == recorded["products"].keys()
    for guid, product in recorded["products"].items():
        fresh = current["products"][guid]
        assert fresh["entity"] == product["entity"]
        if product["bbox"] is None:
            assert fresh["bbox"] is None
        else:
            for axis in range(3):
                assert fresh["bbox"][0][axis] == pytest.approx(product["bbox"][0][axis], abs=1e-6)
                assert fresh["bbox"][1][axis] == pytest.approx(product["bbox"][1][axis], abs=1e-6)
        for key in ("container", "type", "materials", "psets", "typePsets", "quantities"):
            assert fresh.get(key) == product.get(key), f"{product['name']}: {key}"


@pytest.mark.parametrize("file_name", sorted(VARIANTS))
def test_same_building_in_every_unit(file_name):
    """A mesma edificação em metros, milímetros e pés ocupa os mesmos metros."""
    recorded = json.loads(
        (FIXTURES / f"{Path(file_name).stem}.expected.json").read_text(encoding="utf-8")
    )
    wall = next(p for p in recorded["products"].values() if p["name"] == "Parede B")
    origin = VARIANTS[file_name].site_origin
    # Parede B: 3,0 × 0,2 × 2,8 m, girada 90° no pavimento e 30° com o edifício.
    assert wall["volume"] == pytest.approx(3.0 * 0.2 * 2.8, abs=1e-3)
    assert wall["bbox"][0][2] == pytest.approx(origin[2], abs=1e-6)
    assert wall["bbox"][1][2] - wall["bbox"][0][2] == pytest.approx(2.8, abs=1e-6)


def _model(model_id: str, object_ids: list[str]) -> dict:
    return {
        "id": model_id,
        "name": "predio-ifc4-mm.ifc",
        "source": {
            "fileName": "predio-ifc4-mm.ifc",
            "byteLength": 13000,
            "sha256": "a" * 64,
            "encoding": "gzip-base64",
            "data": "",
        },
        "schema": "IFC4",
        "lengthUnit": "MILLIMETRE",
        "unitScale": 0.001,
        "importedAt": "2026-11-22T12:00:00.000Z",
        "placementMode": "offset",
        "placement": {"translation": {"x": -100.0, "y": -50.0, "z": 0.0}, "rotation": 0.5},
        "visible": True,
        "opacity": 0.4,
        "objects": [
            {
                "id": object_id,
                "expressId": 61 + index,
                "globalId": "2sUzXhRY1O0BS2_H9T5vH4",
                "transform": None
                if index == 0
                else {"translation": {"x": 0.0, "y": 4.0, "z": 0.0}, "rotation": 0.0},
                "copy": index > 0,
            }
            for index, object_id in enumerate(object_ids)
        ],
    }


def test_project_with_imported_model_validates(client, project_document):
    project_document["ifcModels"] = [_model("ifc-1", ["obj-1", "obj-2"])]
    response = client.post("/api/v1/projects/validate", json=project_document)
    assert response.status_code == 200, response.text
    assert response.json()["valid"] is True, response.json()


def test_imported_model_identities_must_be_unique(client, project_document):
    project_document["ifcModels"] = [
        _model("ifc-1", ["obj-1", "obj-1"]),
        _model("ifc-1", ["obj-3"]),
    ]
    response = client.post("/api/v1/projects/validate", json=project_document)
    assert response.status_code == 200, response.text
    codes = [issue["code"] for issue in response.json()["issues"]]
    assert codes.count("DUPLICATE_ID") == 2


def test_imported_model_contract_is_strict(client, project_document):
    broken = _model("ifc-1", ["obj-1"])
    broken["opacity"] = 0
    broken["source"]["sha256"] = "xyz"
    project_document["ifcModels"] = [broken]
    response = client.post("/api/v1/projects/validate", json=project_document)
    assert response.status_code == 422


def test_v18_document_migrates_without_imported_models(client, project_document):
    legacy = {key: value for key, value in project_document.items() if key != "ifcModels"}
    legacy["schemaVersion"] = 18
    response = client.post("/api/v1/projects/validate", json=legacy)
    assert response.status_code == 200, response.text
    assert response.json()["valid"] is True, response.json()
