"""Desenho da folha no tipo de porta (esquema v20): frisos opcionais."""

import copy
import json

import pytest
from pydantic import ValidationError

from hydrobim_api.models.project import SCHEMA_VERSION, Project
from hydrobim_api.services.validation import validate_project

LEAF = {
    "friezes": [
        {"orientation": "horizontal", "position": 0.5},
        {"orientation": "vertical", "position": 0.2},
    ],
    "friezeWidth": 0.016,
    "schematic": True,
}


def door_type(document):
    door = document["architecture"]["types"][3]
    assert door["category"] == "door"
    return door


def test_schema_version_is_20():
    assert SCHEMA_VERSION == 20


def test_door_leaf_round_trips(arch_document):
    door_type(arch_document)["leaf"] = copy.deepcopy(LEAF)
    project = Project.model_validate(arch_document)
    leaf = project.architecture.types[3].leaf
    assert [f.orientation for f in leaf.friezes] == ["horizontal", "vertical"]
    assert leaf.frieze_width == 0.016
    assert leaf.schematic is True
    assert project.model_dump(by_alias=True) == arch_document
    assert json.loads(project.model_dump_json(by_alias=True)) == arch_document
    assert validate_project(project) == []


def test_door_without_leaf_stays_without_the_field(arch_document):
    project = Project.model_validate(arch_document)
    assert "leaf" not in project.model_dump(by_alias=True)["architecture"]["types"][3]


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("friezes",), []),
        (("friezes", 0, "position"), 0),
        (("friezes", 0, "position"), 1),
        (("friezes", 0, "position"), 1.5),
        (("friezes", 0, "orientation"), "diagonal"),
        (("friezeWidth",), 0),
        (("schematic",), "sim"),
    ],
)
def test_door_leaf_constraints(arch_document, path, value):
    leaf = copy.deepcopy(LEAF)
    target = leaf
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    door_type(arch_document)["leaf"] = leaf
    with pytest.raises(ValidationError):
        Project.model_validate(arch_document)


def test_migrates_v19_without_changing_input(arch_document):
    legacy = {**arch_document, "schemaVersion": 19}
    snapshot = copy.deepcopy(legacy)
    project = Project.model_validate(legacy)
    assert legacy == snapshot
    assert project.schema_version == 20
    assert project.model_dump(by_alias=True) == arch_document
