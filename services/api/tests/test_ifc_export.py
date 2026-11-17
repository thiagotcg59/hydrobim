"""Verificação independente do IFC-SPF exportado pelo pacote TypeScript do cliente."""

import json
import math
import re
import uuid
from collections import Counter
from pathlib import Path

import ifcopenshell
import ifcopenshell.validate
import pytest

EXAMPLES = sorted((Path(__file__).resolve().parents[3] / "examples").glob("*.ifc"))
PARAMETERS = EXAMPLES or [
    pytest.param(
        None,
        marks=pytest.mark.skip(
            reason="Nenhum IFC em examples/. Execute npm run examples:generate."
        ),
    )
]
IDS = [path.name for path in EXAMPLES] or ["sem-exemplos"]
CLASSES = {
    "pipe": ("IfcPipeSegment", "RIGIDSEGMENT"),
    "elbow": ("IfcPipeFitting", "BEND"),
    "tee": ("IfcPipeFitting", "JUNCTION"),
    "reducer": ("IfcPipeFitting", "TRANSITION"),
    "pump": ("IfcPump", "ENDSUCTION"),
    "tank": ("IfcTank", "STORAGE"),
}
VALVES = {
    "gate": "ISOLATING",
    "ball": "ISOLATING",
    "butterfly": "ISOLATING",
    "globe": "REGULATING",
    "check": "CHECK",
    "airRelease": "AIRRELEASE",
}


def global_id(identifier):
    try:
        value = uuid.UUID(identifier)
    except ValueError:
        value = uuid.uuid5(uuid.UUID(int=0), f"HydroBIM:{identifier}:legacy")
    return ifcopenshell.guid.compress(value.hex)


def source_document(path):
    return json.loads(path.with_suffix(".hydrobim.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("example", PARAMETERS, ids=IDS)
def test_ifc_schema_and_model(example):
    model = ifcopenshell.open(str(example))
    assert model.schema == "IFC4X3"
    assert model.schema_identifier == "IFC4X3_ADD2"
    logger = ifcopenshell.validate.json_logger()
    ifcopenshell.validate.validate(model, logger, express_rules=True)
    errors = [entry for entry in logger.statements if entry["level"] == "error"]
    assert not errors, json.dumps(errors, default=str, ensure_ascii=False, indent=2)

    document = source_document(example)
    elements = document["elements"]
    assert model.by_type("IfcProject")[0].GlobalId == global_id(document["id"])
    assert model.by_type("IfcProject")[0].Name == document["name"]
    expected = Counter(
        ("IfcValve", VALVES[e["valveType"]]) if e["kind"] == "valve" else CLASSES[e["kind"]]
        for e in elements
    )
    actual = Counter(
        (entity.is_a(), entity.PredefinedType) for entity in model.by_type("IfcDistributionElement")
    )
    assert actual == expected
    roots = model.by_type("IfcRoot")
    assert len({e.GlobalId for e in roots}) == len(roots)
    assert all(re.fullmatch(r"[0-3][0-9A-Za-z_$]{21}", e.GlobalId) for e in roots)
    port_count = sum(
        3 if e["kind"] == "tee" else 1 if e.get("valveType") == "airRelease" else 2
        for e in elements
    )
    ports = model.by_type("IfcDistributionPort")
    assert len(ports) == port_count
    assert all(p.PredefinedType == "PIPE" and p.FlowDirection == "NOTDEFINED" for p in ports)
    assert len(model.by_type("IfcRelNests")) == len(elements)
    assert all(len(p.Nests) == 1 for p in ports)
    assert len(model.by_type("IfcRelConnectsPorts")) == len(document["connections"])
    for connection in document["connections"]:
        guid = ifcopenshell.guid.compress(
            uuid.uuid5(uuid.UUID(int=0), f"HydroBIM:{connection['id']}:connection").hex
        )
        relation = model.by_guid(guid)
        for ref, port in [
            (connection["a"], relation.RelatingPort),
            (connection["b"], relation.RelatedPort),
        ]:
            expected_guid = uuid.uuid5(
                uuid.UUID(int=0), f"HydroBIM:{ref['elementId']}:port:{ref['portId']}"
            )
            assert port.GlobalId == ifcopenshell.guid.compress(expected_guid.hex)
            assert port.Nests[0].RelatingObject.GlobalId == global_id(ref["elementId"])

    units = model.by_type("IfcProject")[0].UnitsInContext.Units
    assert {(u.UnitType, u.Name, u.Prefix) for u in units} == {
        ("LENGTHUNIT", "METRE", None),
        ("AREAUNIT", "SQUARE_METRE", None),
        ("VOLUMEUNIT", "CUBIC_METRE", None),
        ("PLANEANGLEUNIT", "RADIAN", None),
    }
    for element in elements:
        entity = model.by_guid(global_id(element["id"]))
        assert entity.Name == element["name"]
        representations = entity.Representation.Representations
        body = next(r for r in representations if r.RepresentationIdentifier == "Body")
        assert body.ContextOfItems.is_a("IfcGeometricRepresentationSubContext")
        assert body.ContextOfItems.TargetView == "MODEL_VIEW"
        assert body.RepresentationType == (
            "SweptSolid" if element["kind"] == "pipe" else "Tessellation"
        )
        assert len(entity.ContainedInStructure) == 1
        container = entity.ContainedInStructure[0].RelatingStructure
        assert entity.ObjectPlacement.PlacementRelTo == container.ObjectPlacement
        if document["discipline"] == "infra":
            assert container.is_a("IfcSite")
        if element["kind"] == "pipe":
            solid = body.Items[0]
            assert solid.is_a("IfcExtrudedAreaSolid")
            assert solid.Depth == pytest.approx(
                math.dist(list(element["start"].values()), list(element["end"].values()))
            )
            assert solid.SweptArea.Radius == pytest.approx(element["spec"]["outerDiameter"] / 2)
            assert solid.SweptArea.WallThickness == pytest.approx(element["spec"]["wallThickness"])

    georeference = document.get("georeference")
    assert len(model.by_type("IfcProjectedCRS")) == (1 if georeference else 0)
    assert len(model.by_type("IfcMapConversion")) == (1 if georeference else 0)
    if georeference:
        conversion = model.by_type("IfcMapConversion")[0]
        assert conversion.SourceCRS.is_a("IfcGeometricRepresentationContext")
        assert conversion.TargetCRS.Name == (
            f"EPSG:{georeference['epsg']}" if georeference["epsg"] else georeference["crsName"]
        )
        assert conversion.Eastings == georeference["eastings"]
        assert conversion.Northings == georeference["northings"]
        assert conversion.OrthogonalHeight == georeference["orthogonalHeight"]
        assert conversion.XAxisAbscissa == pytest.approx(math.cos(georeference["rotation"]))
        assert conversion.XAxisOrdinate == pytest.approx(math.sin(georeference["rotation"]))
        assert conversion.Scale == 1


@pytest.mark.parametrize("example", PARAMETERS, ids=IDS)
def test_ifc_geometry_tessellates(example):
    # Só esta verificação é opcional: erros de create_shape não são mascarados.
    geom = pytest.importorskip(
        "ifcopenshell.geom",
        reason="Módulo geom do IfcOpenShell indisponível; validação de esquema permanece ativa.",
    )
    model = ifcopenshell.open(str(example))
    settings = geom.settings()
    settings.set(settings.USE_WORLD_COORDS, True)
    pipes = model.by_type("IfcPipeSegment")
    fittings = model.by_type("IfcPipeFitting")
    for element in pipes + fittings[:1]:
        shape = geom.create_shape(settings, element)
        assert len(shape.geometry.verts) >= 9, element.GlobalId
        assert len(shape.geometry.faces) >= 3, element.GlobalId
        assert all(math.isfinite(value) for value in shape.geometry.verts)
    # Verifica também o eixo de extrusão e toda a cadeia de placements dos tubos.
    document = source_document(example)
    for source in (e for e in document["elements"] if e["kind"] == "pipe"):
        shape = geom.create_shape(settings, model.by_guid(global_id(source["id"])))
        start = tuple(source["start"][axis] for axis in "xyz")
        end = tuple(source["end"][axis] for axis in "xyz")
        length = math.dist(start, end)
        direction = [(b - a) / length for a, b in zip(start, end, strict=True)]
        vertices = shape.geometry.verts
        projections = [
            sum((vertices[i + j] - start[j]) * direction[j] for j in range(3))
            for i in range(0, len(vertices), 3)
        ]
        assert min(projections) == pytest.approx(0, abs=1e-6)
        assert max(projections) == pytest.approx(length, abs=1e-6)
