import json

import pytest
from pydantic import ValidationError

from hydrobim_api.models.project import Project


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
    assert project.schema_version == 1
    assert project.elements[0].spec.outer_diameter == 0.025
    assert Project.model_validate(project.model_dump(by_alias=False)) == project


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("schemaVersion",), 2),
        (("schemaVersion",), True),
        (("schemaVersion",), "1"),
        (("units", "length"), "mm"),
        (("units", "angle"), "deg"),
        (("systems",), []),
        (("systems", 0, "kind"), "unknown"),
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
    project_document["schemaVersion"] = 1.0
    project_document["elements"][0]["meta"]["revision"] = 1.0
    project_document["elements"][0]["spec"]["standard"] = ""
    assert Project.model_validate(project_document).model_dump(by_alias=True) == project_document


def test_unknown_fields_are_stripped_like_zod(project_document):
    project_document["unknown"] = "ignored"
    project_document["elements"][0]["spec"]["unknown"] = "ignored"
    output = Project.model_validate(project_document).model_dump(by_alias=True)
    assert "unknown" not in output
    assert "unknown" not in output["elements"][0]["spec"]
