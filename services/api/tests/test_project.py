import json
from copy import deepcopy

import pytest
from pydantic import ValidationError

from hydrobim_api.models.project import Project
from hydrobim_api.services.validation import validate_project


@pytest.mark.parametrize(
    "manufacturing", [{}, {"manufacturer": "Fabricante"}, {"model": "", "partNumber": "P-1"}]
)
def test_round_trip(project_document, manufacturing):
    project_document["elements"][0]["manufacturing"] = manufacturing
    project = Project.model_validate(project_document)
    assert project.model_dump(by_alias=True) == project_document
    assert project.model_dump() == project_document
    assert json.loads(project.model_dump_json(by_alias=True)) == project_document


def test_python_attributes_accept_snake_case(project_document):
    project = Project.model_validate(project_document)
    assert project.schema_version == 4
    assert project.elements[0].spec.outer_diameter == 0.025
    assert Project.model_validate(project.model_dump(by_alias=False)) == project


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("schemaVersion",), 5),
        (("schemaVersion",), True),
        (("schemaVersion",), "1"),
        (("units", "length"), "mm"),
        (("units", "angle"), "deg"),
        (("systems",), []),
        (("systems", 0, "kind"), "unknown"),
        (("systems", 0, "color"), "red"),
        (("systems", 0, "visible"), None),
        (("elements", 2, "branchSpec"), None),
        (("elements", 3, "height"), 0),
        (("elements", 3, "handwheelDiameter"), None),
        (("discipline",), "unknown"),
        (("id",), ""),
        (("elements", 0, "spec", "material"), "copper"),
        (("elements", 0, "spec", "jointType"), "unknown"),
        (("elements", 0, "spec", "dn"), "20"),
        (("elements", 0, "spec", "dn"), True),
        (("elements", 0, "spec", "innerDiameter"), 0),
        (("elements", 0, "spec", "wallThickness"), -1),
        (("elements", 0, "spec", "specificationId"), ""),
        (("elements", 0, "manufacturing", "manufacturer"), None),
        (("elements", 0, "manufacturing", "model"), None),
        (("elements", 0, "manufacturing", "partNumber"), None),
        (("elements", 0, "meta", "revision"), -1),
        (("elements", 0, "meta", "revision"), 1.5),
        (("elements", 0, "meta", "revision"), "1"),
        (("elements", 0, "meta", "revision"), True),
        (("elements", 0, "properties", "bad"), None),
        (("elements", 0, "properties", "bad"), []),
        (("elements", 0, "properties", "bad"), {}),
        (("elements", 1, "angle"), 0),
        (("elements", 1, "bendRadius"), -1),
        (("elements", 1, "placement", "rotation", "w"), float("inf")),
        (("elements", 2, "runLength"), 0),
        (("elements", 2, "branchLength"), -1),
        (("elements", 3, "valveType"), "unknown"),
        (("elements", 3, "length"), 0),
        (("elements", 4, "length"), -1),
        (("elements", 4, "outletSpec", "dn"), 0),
        (("connections", 0, "a", "portId"), ""),
        (("connections", 0, "b", "elementId"), ""),
    ],
)
def test_schema_constraints(project_document, path, value):
    target = project_document
    for segment in path[:-1]:
        target = target[segment]
    target[path[-1]] = value
    with pytest.raises(ValidationError):
        Project.model_validate(project_document)


def test_nullable_pressure_class_is_required(project_document):
    del project_document["elements"][0]["spec"]["pressureClass"]
    with pytest.raises(ValidationError):
        Project.model_validate(project_document)


def test_zod_permits_empty_strings_and_integral_floats(project_document):
    project_document["name"] = ""
    project_document["createdAt"] = "not-an-iso-date"
    project_document["schemaVersion"] = 4.0
    project_document["elements"][0]["meta"]["revision"] = 1.0
    project_document["elements"][0]["spec"]["standard"] = ""
    assert Project.model_validate(project_document).model_dump(by_alias=True) == project_document


def test_unknown_fields_are_stripped_like_zod(project_document):
    project_document["unknown"] = "ignored"
    project_document["elements"][0]["spec"]["unknown"] = "ignored"
    output = Project.model_validate(project_document).model_dump(by_alias=True)
    assert "unknown" not in output
    assert "unknown" not in output["elements"][0]["spec"]


def test_migrates_v1_without_changing_input(project_document):
    legacy = deepcopy(project_document)
    legacy["schemaVersion"] = 1
    for key in ("levels", "families", "georeference", "terrain", "annotations", "drawingScale"):
        del legacy[key]
    for element in legacy["elements"]:
        del element["familyId"]
        element.pop("ends", None)
    before = deepcopy(legacy)
    assert Project.model_validate(legacy).model_dump() == project_document
    assert legacy == before


def test_migrates_v2_without_changing_input(project_document):
    legacy = deepcopy(project_document)
    legacy["schemaVersion"] = 2
    del legacy["annotations"], legacy["drawingScale"]
    before = deepcopy(legacy)
    assert Project.model_validate(legacy).model_dump() == project_document
    assert legacy == before


def test_migrates_v3_adding_annotations_and_scale(project_document):
    legacy = deepcopy(project_document)
    legacy["schemaVersion"] = 3
    del legacy["annotations"], legacy["drawingScale"]
    before = deepcopy(legacy)
    assert Project.model_validate(legacy).model_dump() == project_document
    assert legacy == before


def test_plan_annotations_round_trip(project_document):
    project_document["drawingScale"] = 100
    project_document["annotations"] = [
        {
            "id": "cota-1",
            "kind": "dimension",
            "a": {"x": 0, "y": 0},
            "b": {"x": 1, "y": 0},
            "offset": 0.4,
            "mode": "aligned",
        },
        {
            "id": "texto-1",
            "kind": "text",
            "position": {"x": 2, "y": 1},
            "text": "CASA DE MÁQUINAS",
            "rotation": 0,
        },
        {
            "id": "chamada-1",
            "kind": "text",
            "position": {"x": 2, "y": 2},
            "text": "RECALQUE",
            "rotation": 0,
            "leader": {"x": 1, "y": 0},
        },
        {
            "id": "etiqueta-1",
            "kind": "tag",
            "elementId": "pipe-1",
            "position": {"x": 0.5, "y": 0.2},
        },
    ]
    project = Project.model_validate(project_document)
    assert project.model_dump(by_alias=True) == project_document
    assert validate_project(project) == []


@pytest.mark.parametrize(
    ("index", "key", "value"),
    [
        (0, "mode", "radial"),
        (0, "offset", "0.4"),
        (1, "text", ""),
        (3, "elementId", ""),
        (3, "kind", "balloon"),
    ],
)
def test_rejects_invalid_annotations(project_document, index, key, value):
    project_document["annotations"] = [
        {
            "id": "cota-1",
            "kind": "dimension",
            "a": {"x": 0, "y": 0},
            "b": {"x": 1, "y": 0},
            "offset": 0.4,
            "mode": "aligned",
        },
        {"id": "t", "kind": "text", "position": {"x": 2, "y": 1}, "text": "A", "rotation": 0},
        {"id": "u", "kind": "text", "position": {"x": 2, "y": 1}, "text": "B", "rotation": 0},
        {"id": "e", "kind": "tag", "elementId": "pipe-1", "position": {"x": 0.5, "y": 0.2}},
    ]
    project_document["annotations"][index][key] = value
    with pytest.raises(ValidationError):
        Project.model_validate(project_document)


def test_tag_of_missing_element_is_reported(project_document):
    project_document["annotations"] = [
        {"id": "e", "kind": "tag", "elementId": "nao-existe", "position": {"x": 0, "y": 0}}
    ]
    issues = validate_project(Project.model_validate(project_document))
    assert [issue.code for issue in issues] == ["DANGLING_ANNOTATION"]


def test_pressure_reducing_valve_with_width(project_document):
    valve = next(e for e in project_document["elements"] if e["kind"] == "valve")
    valve["valveType"] = "pressureReducing"
    valve["width"] = 0.255
    project = Project.model_validate(project_document)
    assert project.model_dump(by_alias=True) == project_document


@pytest.mark.parametrize("kind", ["pump", "tank", "valve"])
def test_equipment_and_single_port_air_release(client, project_document, kind):
    element = project_document["elements"][3]
    element["kind"] = kind
    if kind == "pump":
        element.update(dischargeSpec=element["spec"], dischargeOffset=0.2, dischargeHeight=0.3)
    elif kind == "tank":
        element.update(diameter=2, height=3, outletHeight=0, inletHeight=2, nozzleLength=0.15)
    else:
        element["valveType"] = "airRelease"
    response = client.post("/api/v1/projects/validate", json=project_document)
    assert response.status_code == 200
    assert response.json()["valid"] is (kind != "valve")
    if kind == "valve":
        assert {issue["code"] for issue in response.json()["issues"]} == {"DANGLING_CONNECTION"}
