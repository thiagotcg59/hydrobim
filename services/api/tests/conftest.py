"""Projeto construído em Python, independente dos arquivos de exemplo do frontend."""

from copy import deepcopy
from math import pi

import pytest
from fastapi.testclient import TestClient

from hydrobim_api.config import Settings
from hydrobim_api.main import create_app


@pytest.fixture
def client():
    with TestClient(create_app(Settings())) as test_client:
        yield test_client


@pytest.fixture
def project_document():
    timestamp = "2026-11-16T12:00:00Z"
    spec = {
        "specificationId": "pvc-soldavel-nbr5648",
        "material": "pvc",
        "standard": "ABNT NBR 5648",
        "jointType": "solventWeld",
        "pressureClass": None,
        "dn": 20,
        "sizeLabel": "DE 25 (DN 20)",
        "outerDiameter": 0.025,
        "innerDiameter": 0.021,
        "wallThickness": 0.002,
    }
    small_spec = {
        **spec,
        "dn": 15,
        "sizeLabel": "DE 20 (DN 15)",
        "outerDiameter": 0.020,
        "innerDiameter": 0.016,
    }
    placement = {
        "position": {"x": 1.0, "y": 0.0, "z": 0.0},
        "rotation": {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0},
    }

    def element(element_id, kind, **fields):
        return {
            "id": element_id,
            "name": element_id,
            "systemId": "cold-water",
            "spec": deepcopy(spec),
            "familyId": None,
            **({"ends": {}} if kind != "pipe" else {}),
            "properties": {"observacao": "Teste", "coeficiente": 1.5, "ativo": True},
            "manufacturing": {},
            "meta": {"createdAt": timestamp, "updatedAt": timestamp, "revision": 0},
            "kind": kind,
            **deepcopy(fields),
        }

    def connection(number, a, a_port, b, b_port):
        return {
            "id": f"connection-{number}",
            "a": {"elementId": a, "portId": a_port},
            "b": {"elementId": b, "portId": b_port},
        }

    return {
        "format": "hydrobim-project",
        "schemaVersion": 20,
        "id": "project-test",
        "name": "Projeto de teste",
        "discipline": "mep",
        "units": {"length": "m", "angle": "rad"},
        "createdAt": timestamp,
        "updatedAt": timestamp,
        "systems": [{"id": "cold-water", "name": "Água fria", "kind": "domesticColdWater"}],
        "levels": [{"id": "nivel-0", "name": "Térreo", "elevation": 0}],
        "families": [],
        "tankFamilies": [],
        "pumpFamilies": [],
        "ifcTypes": {},
        "georeference": None,
        "terrain": None,
        "earthworks": {
            "platforms": [],
            "swellPercent": None,
            "compactionFactor": None,
            "reusePercent": None,
        },
        "annotations": [],
        "views": [],
        "architecture": {"types": [], "elements": []},
        "ifcModels": [],
        "drawingScale": 50,
        "infra": {
            "drawingScale": 1000,
            "basemap": {"sourceId": None, "visible": True, "opacity": 1},
            "layers": {
                "network": True,
                "equipment": True,
                "terrain": True,
                "references": True,
                "annotations": True,
            },
            "labels": {"names": False, "lengths": False, "elevations": False},
        },
        "elements": [
            element(
                "pipe-1",
                "pipe",
                start={"x": 0.0, "y": 0.0, "z": 0.0},
                end={"x": 1.0, "y": 0.0, "z": 0.0},
            ),
            element("elbow-1", "elbow", placement=placement, angle=pi / 2, bendRadius=0.0375),
            element("tee-1", "tee", placement=placement, runLength=0.075, branchLength=0.0375),
            element("valve-1", "valve", placement=placement, valveType="ball", length=0.075),
            element(
                "reducer-1", "reducer", placement=placement, outletSpec=small_spec, length=0.05
            ),
            element(
                "pipe-2",
                "pipe",
                spec=small_spec,
                start={"x": 2.0, "y": 0.0, "z": 0.0},
                end={"x": 3.0, "y": 0.0, "z": 0.0},
            ),
        ],
        "connections": [
            connection(1, "pipe-1", "end", "elbow-1", "a"),
            connection(2, "elbow-1", "b", "tee-1", "a"),
            connection(3, "tee-1", "b", "valve-1", "a"),
            connection(4, "valve-1", "b", "reducer-1", "a"),
            connection(5, "reducer-1", "b", "pipe-2", "start"),
        ],
    }


@pytest.fixture
def arch_document(project_document):
    """Projeto v16 com arquitetura: trechos do exemplo `edificacao-simples`, no nível de teste."""
    meta = {"createdAt": "2026-11-21T12:00:00Z", "updatedAt": "2026-11-21T12:00:00Z", "revision": 0}

    def arch_type(type_id, name, category, predefined, **fields):
        return {
            "id": type_id,
            "name": name,
            "familyId": None,
            "generic": True,
            "source": None,
            "manufacturing": {},
            "classifications": [],
            "ifcPredefinedType": predefined,
            "ifc": {},
            "category": category,
            **fields,
        }

    def layer(layer_id, material, thickness, function, hatch="none"):
        return {
            "id": layer_id,
            "material": material,
            "thickness": thickness,
            "function": function,
            "hatch": hatch,
        }

    def occurrence(element_id, kind, **fields):
        return {
            "id": element_id,
            "name": element_id,
            "properties": {},
            "meta": deepcopy(meta),
            "kind": kind,
            **deepcopy(fields),
        }

    hosted = {"hostId": "wall-1", "hand": "left", "facing": 1}
    floor = {
        "levelId": "nivel-0",
        "boundary": [{"x": 0, "y": 0}, {"x": 6, "y": 0}, {"x": 6, "y": 4}, {"x": 0, "y": 4}],
        "offset": 0,
    }
    opening = {
        "id": "opening-1",
        "boundary": [
            {"x": 5.3, "y": 3.7},
            {"x": 5.7, "y": 3.7},
            {"x": 5.7, "y": 3.3},
            {"x": 5.3, "y": 3.3},
        ],
    }
    project_document["discipline"] = "architecture"
    project_document["architecture"] = {
        "types": [
            arch_type(
                "type-wall",
                "Alvenaria cerâmica 18 cm",
                "wall",
                "SOLIDWALL",
                familyId="arq-parede-alvenaria-ceramica",
                classifications=[
                    {"system": "nbr15965", "table": "3E", "code": "3E 04 10"},
                    {"system": "other", "code": "X-1", "description": "Código interno"},
                ],
                ifc={"Pset_WallCommon.IsExternal": True},
                layers=[
                    layer("layer-1", "Revestimento argamassado", 0.02, "finish"),
                    layer("layer-2", "Alvenaria de bloco cerâmico", 0.14, "structure", "diagonal"),
                    layer("layer-3", "Revestimento argamassado", 0.02, "finish"),
                ],
            ),
            arch_type(
                "type-slab",
                "Laje maciça 12 cm",
                "slab",
                "FLOOR",
                layers=[layer("layer-4", "Concreto armado", 0.12, "structure", "dotted")],
            ),
            arch_type(
                "type-flooring",
                "Porcelanato sobre contrapiso",
                "flooring",
                "FLOORING",
                layers=[
                    layer("layer-5", "Placa cerâmica ou porcelanato", 0.01, "finish"),
                    layer("layer-6", "Contrapiso", 0.04, "substrate"),
                ],
            ),
            arch_type(
                "type-door",
                "Porta de giro 80 × 210",
                "door",
                "DOOR",
                operation="singleSwing",
                width=0.8,
                height=2.1,
                frameWidth=0.05,
                panelThickness=0.035,
                materials={"frame": "Madeira", "panel": "Madeira"},
            ),
            arch_type(
                "type-window",
                "Janela de correr 120 × 100",
                "window",
                "WINDOW",
                operation="sliding",
                width=1.2,
                height=1,
                sillHeight=1.1,
                panels=2,
                frameWidth=0.05,
                materials={},
            ),
        ],
        "elements": [
            occurrence(
                "wall-1",
                "wall",
                typeId="type-wall",
                levelId="nivel-0",
                start={"x": 0, "y": 0},
                end={"x": 6, "y": 0},
                locationLine="center",
                baseOffset=0,
                height=2.8,
                ifc={"Pset_WallCommon.LoadBearing": False},
            ),
            occurrence("door-1", "door", typeId="type-door", offset=1.2, sillHeight=0, **hosted),
            occurrence(
                "window-1", "window", typeId="type-window", offset=2.8, sillHeight=1.1, **hosted
            ),
            occurrence("slab-1", "slab", typeId="type-slab", openings=[opening], **floor),
            occurrence("flooring-1", "flooring", typeId="type-flooring", openings=[], **floor),
            occurrence("space-1", "space", number="01", height=2.6, **floor),
            occurrence("space-2", "space", height=None, **floor),
        ],
    }
    return project_document
