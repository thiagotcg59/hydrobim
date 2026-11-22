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
    # Esquema v14: a cruzeta é uma junção (mais de duas portas), como o tê.
    "cross": ("IfcPipeFitting", "JUNCTION"),
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
    "pressureReducing": "PRESSUREREDUCING",
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
        # O filtro Y é um tipo interno de válvula, mas no IFC é IfcFilter/STRAINER.
        ("IfcFilter", "STRAINER")
        if e.get("valveType") == "strainer"
        # O macromedidor também é um tipo interno de válvula: no IFC, IfcFlowMeter/WATERMETER.
        else ("IfcFlowMeter", "WATERMETER")
        if e.get("valveType") == "flowMeter"
        else ("IfcValve", VALVES[e["valveType"]])
        if e["kind"] == "valve"
        # Bomba anfíbia de catálogo: motobomba submersa (SUBMERSIBLEPUMP), em linha.
        else ("IfcPump", "SUBMERSIBLEPUMP")
        if e["kind"] == "pump" and e.get("pumpType") == "amphibious"
        else CLASSES[e["kind"]]
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
        4
        if e["kind"] == "cross"
        else 3
        if e["kind"] == "tee"
        else 1
        if e.get("valveType") == "airRelease"
        else 2 + len(e.get("nozzles", []))
        for e in elements
    )
    ports = model.by_type("IfcDistributionPort")
    assert len(ports) == port_count
    assert all(p.PredefinedType == "PIPE" for p in ports)
    # Só os bocais de reservatório têm sentido de escoamento: entrada = SINK; saída,
    # extravasor e descarga = SOURCE.
    tank_ids = {global_id(e["id"]) for e in elements if e["kind"] == "tank"}
    for port in ports:
        if port.Nests[0].RelatingObject.GlobalId in tank_ids:
            assert port.FlowDirection == ("SINK" if port.Name.startswith("Entrada") else "SOURCE")
        else:
            assert port.FlowDirection == "NOTDEFINED"
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
    assert {(u.UnitType, u.Name, u.Prefix) for u in units if u.is_a("IfcSIUnit")} == {
        ("LENGTHUNIT", "METRE", None),
        ("AREAUNIT", "SQUARE_METRE", None),
        ("VOLUMEUNIT", "CUBIC_METRE", None),
        ("PLANEANGLEUNIT", "RADIAN", None),
        ("TIMEUNIT", "SECOND", None),
        ("PRESSUREUNIT", "PASCAL", None),
        ("POWERUNIT", "WATT", None),
        # Arquitetura: massa (kg) e temperatura (K) entram na transmitância térmica.
        ("MASSUNIT", "GRAM", "KILO"),
        ("THERMODYNAMICTEMPERATUREUNIT", "KELVIN", None),
    }
    # Unidades derivadas das propriedades de vazão (m³/s), de rotação (s⁻¹) e de
    # transmitância térmica (W/m²·K).
    assert {u.UnitType for u in units if u.is_a("IfcDerivedUnit")} == {
        "VOLUMETRICFLOWRATEUNIT",
        "ROTATIONALFREQUENCYUNIT",
        "THERMALTRANSMITTANCEUNIT",
    }
    for element in elements:
        entity = model.by_guid(global_id(element["id"]))
        assert entity.Name == element["name"]
        representations = entity.Representation.Representations
        body = next(r for r in representations if r.RepresentationIdentifier == "Body")
        assert body.ContextOfItems.is_a("IfcGeometricRepresentationSubContext")
        assert body.ContextOfItems.TargetView == "MODEL_VIEW"
        # Tubo liso: sólido varrido; tubo com flanges e peças: malha triangulada.
        swept = element["kind"] == "pipe" and not element.get("ends")
        assert body.RepresentationType == ("SweptSolid" if swept else "Tessellation")
        assert len(entity.ContainedInStructure) == 1
        container = entity.ContainedInStructure[0].RelatingStructure
        assert entity.ObjectPlacement.PlacementRelTo == container.ObjectPlacement
        if document["discipline"] == "infra":
            assert container.is_a("IfcSite")
        if swept:
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


def _psets(entity):
    """Conjuntos de propriedades de uma ocorrência: {conjunto: {propriedade: valor}}."""
    result = {}
    for relation in entity.IsDefinedBy:
        definition = relation.RelatingPropertyDefinition
        if definition.is_a("IfcPropertySet"):
            result[definition.Name] = {
                p.Name: (
                    p.NominalValue.wrappedValue
                    if p.is_a("IfcPropertySingleValue") and p.NominalValue is not None
                    else p.EnumerationValues[0].wrappedValue
                    if p.is_a("IfcPropertyEnumeratedValue")
                    else None
                )
                for p in definition.HasProperties
            }
    return result


def _catalog_tanks(example):
    return [
        e
        for e in source_document(example)["elements"]
        if e["kind"] == "tank" and e.get("tankType", "generic") != "generic"
    ]


TANK_EXAMPLES = [path for path in EXAMPLES if _catalog_tanks(path)]


def test_there_is_an_example_with_catalog_tanks():
    assert TANK_EXAMPLES, "Nenhum exemplo com reservatórios de catálogo em examples/."
    kinds = {e["tankType"] for path in TANK_EXAMPLES for e in _catalog_tanks(path)}
    assert kinds == {
        "gobletWet",
        "gobletDry",
        "tubular",
        "australian",
        "verticalGround",
        "verticalConeLegs",
        "fieldErected",
        "horizontal",
    }


@pytest.mark.parametrize("example", TANK_EXAMPLES, ids=[p.name for p in TANK_EXAMPLES])
def test_catalog_tanks_keep_classification_and_parameters(example):
    """Reabre o IFC e confere, contra o projeto, classe, tipo, material e propriedades."""
    model = ifcopenshell.open(str(example))
    tanks = _catalog_tanks(example)
    assert len(model.by_type("IfcTankType")) == len(tanks)
    material = model.by_type("IfcMaterial")
    assert [m.Name for m in material if m.Category == "steel"] == ["Aço-carbono estrutural"]
    for source in tanks:
        entity = model.by_guid(global_id(source["id"]))
        assert entity.is_a("IfcTank") and entity.PredefinedType == "STORAGE"
        tank_type = entity.IsTypedBy[0].RelatingType
        assert tank_type.is_a("IfcTankType") and tank_type.PredefinedType == "STORAGE"
        assert tank_type.Name == source["manufacturing"]["model"]
        assert [
            a.RelatingMaterial.Name
            for a in entity.HasAssociations
            if a.is_a("IfcRelAssociatesMaterial")
        ] == ["Aço-carbono estrutural"]

        psets = _psets(entity)
        tramec = psets["Pset_TRAMEC_Reservatorio"]
        support = source.get("supportHeight", 0)
        total = {
            "australian": support + source["height"],
            "horizontal": support + source["diameter"],
        }.get(source["tankType"], source["height"])
        assert tramec["Manufacturer"] == "TRAMEC"
        assert tramec["Model"] == source["manufacturing"]["model"]
        assert tramec["NominalCapacity"] == pytest.approx(source["nominalCapacity"])
        assert tramec["TotalHeight"] == pytest.approx(total)
        assert tramec["Diameter"] == pytest.approx(source["diameter"])
        assert tramec["Material"] == "Aço-carbono estrutural"
        assert "tramec.com.br" in tramec["CatalogReference"]
        assert tramec["NumberOfCompartments"] == source.get("compartments", 1)
        for name, key in [
            ("ColumnHeight", "columnHeight"),
            ("ConeHeight", "coneHeight"),
            ("SupportHeight", "supportHeight"),
            ("ShellThickness", "shellThickness"),
            ("Length", "length"),
        ]:
            # Ausente no projeto = propriedade presente, mas sem valor (nada é inventado).
            assert name in tramec
            if key in source:
                assert tramec[name] == pytest.approx(source[key])
            else:
                assert tramec[name] is None
        assert {"BottomType", "InstallationType", "ReservoirType"} <= tramec.keys()
        assert psets["Pset_TankOccurrence"]["HasLadder"] is source["accessories"]["ladder"]
        origins = psets["HydroBIM_Reservatorio_OrigemDosParametros"]
        assert origins["ShellThickness"].startswith(
            "definido" if "shellThickness" in source else "estimado"
        )
        if "variantId" in source:
            assert origins["Diameter"] == "catálogo" and origins["Height"] == "catálogo"

        type_psets = {p.Name: p for p in tank_type.HasPropertySets}
        common = {p.Name: p for p in type_psets["Pset_TankTypeCommon"].HasProperties}
        assert common["TankNominalCapacity"].NominalValue.wrappedValue == pytest.approx(
            source["nominalCapacity"]
        )
        assert common["PatternType"].EnumerationValues[0].wrappedValue == (
            "HORIZONTALCYLINDER" if source["tankType"] == "horizontal" else "VERTICALCYLINDER"
        )
        assert "Pset_ManufacturerTypeInformation" in type_psets

        quantities = next(
            r.RelatingPropertyDefinition
            for r in entity.IsDefinedBy
            if r.RelatingPropertyDefinition.is_a("IfcElementQuantity")
        )
        by_name = {q.Name: q for q in quantities.Quantities}
        assert by_name["NominalCapacity"].VolumeValue == pytest.approx(source["nominalCapacity"])
        assert by_name["TotalHeight"].LengthValue == pytest.approx(total)
        assert by_name["ProjectedArea"].is_a("IfcQuantityArea")

        # Bocais: função, sentido, posição e diâmetro da especificação escolhida.
        ports = {p.Name: p for p in entity.IsNestedBy[0].RelatedObjects}
        assert len(ports) == 2 + len(source.get("nozzles", []))
        assert ports["Saída"].FlowDirection == "SOURCE"
        assert ports["Entrada"].FlowDirection == "SINK"
        for nozzle in source.get("nozzles", []):
            label = {"overflow": "Extravasor", "drain": "Descarga"}[nozzle["role"]]
            port = ports[label]
            assert port.FlowDirection == "SOURCE"
            port_psets = _psets(port)
            pipe = port_psets["Pset_DistributionPortTypePipe"]
            assert pipe["OuterDiameter"] == pytest.approx(nozzle["spec"]["outerDiameter"])
            assert pipe["NominalDiameter"] == pytest.approx(nozzle["spec"]["dn"] / 1000)
            assert port_psets["HydroBIM_Bocal"]["HeightAboveBase"] == pytest.approx(
                nozzle["height"]
            )
            location = port.ObjectPlacement.RelativePlacement.Location.Coordinates
            assert location[2] == pytest.approx(nozzle["height"])


@pytest.mark.parametrize("example", TANK_EXAMPLES, ids=[p.name for p in TANK_EXAMPLES])
def test_catalog_tank_geometry_survives_reimport(example):
    """A malha lida do IFC tem as dimensões do projeto e está na posição do elemento."""
    geom = pytest.importorskip(
        "ifcopenshell.geom",
        reason="Módulo geom do IfcOpenShell indisponível; validação de esquema permanece ativa.",
    )
    model = ifcopenshell.open(str(example))
    settings = geom.settings()
    settings.set(settings.USE_WORLD_COORDS, True)
    for source in _catalog_tanks(example):
        shape = geom.create_shape(settings, model.by_guid(global_id(source["id"])))
        verts = shape.geometry.verts
        xs, ys, zs = verts[0::3], verts[1::3], verts[2::3]
        assert len(shape.geometry.faces) > 300, source["name"]
        origin = source["placement"]["position"]
        accessories = source["accessories"]
        support = source.get("supportHeight", 0)
        top = {
            "australian": support + source["height"],
            "horizontal": support + source["diameter"],
        }.get(source["tankType"], source["height"])
        # Base no piso; topo na altura total, mais o guarda-corpo quando existe.
        assert min(zs) == pytest.approx(origin["z"], abs=1e-4)
        if accessories["guardrail"]:
            assert max(zs) == pytest.approx(
                origin["z"] + top + accessories["guardrailHeight"], abs=0.03
            )
        elif not accessories["ladder"]:
            assert max(zs) == pytest.approx(origin["z"] + top, abs=1e-3)
        # Em planta, o corpo ocupa ao menos o diâmetro (os bocais e a escada passam dele).
        reach = source.get("length", source["diameter"]) / 2
        assert max(xs) - origin["x"] >= reach - 1e-4
        assert origin["x"] - min(xs) >= reach - 1e-4
        assert max(ys) - min(ys) >= source["diameter"] - 1e-3


@pytest.mark.parametrize("example", PARAMETERS, ids=IDS)
def test_every_body_item_has_a_surface_style(example):
    """Sem estilo de superfície os visualizadores mostram o modelo todo em branco."""
    model = ifcopenshell.open(str(example))
    for product in model.by_type("IfcDistributionElement"):
        for representation in product.Representation.Representations:
            for item in representation.Items:
                assert item.StyledByItem, f"{product.Name}: item sem estilo"
                style = item.StyledByItem[0].Styles[0]
                assert style.is_a("IfcSurfaceStyle")
                rendering = style.Styles[0]
                assert rendering.is_a("IfcSurfaceStyleRendering")
                assert rendering.ReflectanceMethod == "PHYSICAL"
                colour = rendering.SurfaceColour
                assert all(0 <= v <= 1 for v in (colour.Red, colour.Green, colour.Blue))
                assert rendering.DiffuseColour == colour
                assert 0 <= rendering.SpecularColour.wrappedValue <= 1
                assert 0 <= rendering.SpecularHighlight.wrappedValue <= 1
