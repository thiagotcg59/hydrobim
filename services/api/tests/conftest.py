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
        "schemaVersion": 10,
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
        "ifcTypes": {},
        "georeference": None,
        "terrain": None,
        "annotations": [],
        "drawingScale": 50,
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
