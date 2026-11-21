"""Terreno e terraplenagem no IFC exportado, conferidos com o IfcOpenShell."""

import json
import math
from pathlib import Path

import ifcopenshell
import pytest

from tests.test_ifc_export import global_id

EXAMPLE = Path(__file__).resolve().parents[3] / "examples" / "terraplenagem-platos.ifc"

pytestmark = pytest.mark.skipif(
    not EXAMPLE.exists(),
    reason="examples/terraplenagem-platos.ifc ausente. Execute npm run examples:generate.",
)


@pytest.fixture(scope="module")
def model():
    return ifcopenshell.open(str(EXAMPLE))


@pytest.fixture(scope="module")
def document():
    return json.loads(EXAMPLE.with_suffix(".hydrobim.json").read_text(encoding="utf-8"))


def _quantities(entity):
    result = {}
    for relation in entity.IsDefinedBy:
        definition = relation.RelatingPropertyDefinition
        if definition.is_a("IfcElementQuantity"):
            result[definition.Name] = {
                quantity.Name: quantity[3] for quantity in definition.Quantities
            }
    return result


def _properties(entity, name):
    for relation in entity.IsDefinedBy:
        definition = relation.RelatingPropertyDefinition
        if definition.is_a("IfcPropertySet") and definition.Name == name:
            return {
                prop.Name: None if prop.NominalValue is None else prop.NominalValue.wrappedValue
                for prop in definition.HasProperties
            }
    return None


def test_terrain_is_a_geographic_element_in_the_site(model, document):
    terrains = model.by_type("IfcGeographicElement")
    assert len(terrains) == 1
    terrain = terrains[0]
    source = document["terrain"]
    assert terrain.GlobalId == global_id(source["id"])
    assert terrain.Name == source["name"]
    assert terrain.Tag == source["tag"]
    assert terrain.PredefinedType == "TERRAIN"
    assert terrain.ContainedInStructure[0].RelatingStructure.is_a("IfcSite")
    # A malha é a da superfície natural: mesmos vértices e faces do projeto.
    item = terrain.Representation.Representations[0].Items[0]
    assert item.is_a("IfcTriangulatedFaceSet")
    assert item.Closed is False
    assert len(item.Coordinates.CoordList) == len(source["points"])
    assert len(item.CoordIndex) == len(source["triangles"]) // 3
    properties = _properties(terrain, "HydroBIM_Terreno")
    assert properties["SourceProvider"] == source["source"]["provider"]
    # O que a fonte não declara fica sem valor.
    assert properties["VerticalAccuracy"] is None
    heights = [point["z"] for point in source["points"]]
    assert properties["MinElevation"] == pytest.approx(min(heights))
    assert properties["MaxElevation"] == pytest.approx(max(heights))
    area = _quantities(terrain)["HydroBIM_TerrenoQuantidades"]["ProjectedArea"]
    assert area == pytest.approx(120 * 120, rel=1e-9)


def test_cuts_void_the_terrain_and_fills_are_built_elements(model, document):
    terrain = model.by_type("IfcGeographicElement")[0]
    cuts = model.by_type("IfcEarthworksCut")
    fills = model.by_type("IfcEarthworksFill")
    platforms = document["earthworks"]["platforms"]
    assert len(platforms) == 2
    # Platô A (meia encosta): corte e aterro. Platô B: só aterro.
    assert len(cuts) == 1
    assert len(fills) == 2
    for cut in cuts:
        assert cut.PredefinedType == "CUT"
        assert cut.VoidsElements[0].RelatingBuildingElement == terrain
    assert {relation.RelatedOpeningElement for relation in terrain.HasOpenings} == set(cuts)
    for fill in fills:
        assert fill.PredefinedType == "EMBANKMENT"
        assert fill.ContainedInStructure[0].RelatingStructure.is_a("IfcSite")
    names = {platform["name"] for platform in platforms}
    assert all(any(entity.Name.startswith(name) for name in names) for entity in cuts + fills)


def test_earthwork_quantities_convert_volume_states(model, document):
    earthworks = document["earthworks"]
    swell = 1 + earthworks["swellPercent"] / 100
    factor = earthworks["compactionFactor"]
    for cut in model.by_type("IfcEarthworksCut"):
        quantities = _quantities(cut)["Qto_EarthworksCutBaseQuantities"]
        assert quantities["UndisturbedVolume"] > 0
        assert quantities["LooseVolume"] == pytest.approx(quantities["UndisturbedVolume"] * swell)
        parameters = _properties(cut, "HydroBIM_Plato")
        assert parameters["SwellPercent"] == pytest.approx(earthworks["swellPercent"])
    for fill in model.by_type("IfcEarthworksFill"):
        quantities = _quantities(fill)["Qto_EarthworksFillBaseQuantities"]
        assert quantities["CompactedVolume"] > 0
        assert quantities["LooseVolume"] == pytest.approx(
            quantities["CompactedVolume"] / factor * swell
        )
        parameters = _properties(fill, "HydroBIM_Plato")
        platform = next(p for p in earthworks["platforms"] if fill.Name.startswith(p["name"]))
        assert parameters["PlatformElevation"] == pytest.approx(platform["elevation"])
        assert parameters["FillSlopeHorizontalToVertical"] == pytest.approx(platform["fillSlope"])


def test_terrain_and_earthwork_geometry_tessellates(model, document):
    geom = pytest.importorskip(
        "ifcopenshell.geom",
        reason="Módulo geom do IfcOpenShell indisponível.",
    )
    settings = geom.settings()
    settings.set(settings.USE_WORLD_COORDS, True)
    terrain = model.by_type("IfcGeographicElement")[0]
    shape = geom.create_shape(settings, terrain)
    vertices = shape.geometry.verts
    assert all(math.isfinite(value) for value in vertices)
    xs, ys, zs = vertices[0::3], vertices[1::3], vertices[2::3]
    points = document["terrain"]["points"]
    # A cadeia de posicionamentos devolve as coordenadas locais do projeto.
    assert min(xs) == pytest.approx(min(p["x"] for p in points), abs=1e-6)
    assert max(ys) == pytest.approx(max(p["y"] for p in points), abs=1e-6)
    assert min(zs) == pytest.approx(min(p["z"] for p in points), abs=1e-6)
    assert max(zs) == pytest.approx(max(p["z"] for p in points), abs=1e-6)
    for fill in model.by_type("IfcEarthworksFill"):
        platform = next(
            p for p in document["earthworks"]["platforms"] if fill.Name.startswith(p["name"])
        )
        shape = geom.create_shape(settings, fill)
        assert len(shape.geometry.faces) >= 3
        # O topo do aterro é o platô, na cota de implantação.
        assert max(shape.geometry.verts[2::3]) == pytest.approx(platform["elevation"], abs=1e-3)
