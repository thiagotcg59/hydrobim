"""Arquitetura no IFC exportado, conferida com o IfcOpenShell.

O exemplo `edificacao-simples` é gerado pelo cliente (`npm run examples:generate`) a partir
do projeto nativo de mesmo nome. Aqui o arquivo é reaberto e conferido contra o projeto:
entidades e tipos, atributos, vãos (IfcOpeningElement, IfcRelVoidsElement, IfcRelFillsElement),
ambientes como elementos espaciais, camadas de material, unidades e quantitativos — inclusive
o volume do sólido tesselado, com os vãos subtraídos, contra o volume líquido gravado —, e o
telhado (IfcRoof), com a área inclinada, a projeção horizontal e o volume.
"""

import json
import math
from pathlib import Path

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element
import ifcopenshell.util.shape
import ifcopenshell.validate
import pytest

EXAMPLE = Path(__file__).resolve().parents[3] / "examples" / "edificacao-simples.ifc"
pytestmark = pytest.mark.skipif(not EXAMPLE.exists(), reason="Exemplo de arquitetura ausente.")


@pytest.fixture(scope="module")
def model():
    return ifcopenshell.open(EXAMPLE)


@pytest.fixture(scope="module")
def document():
    return json.loads(EXAMPLE.with_suffix(".hydrobim.json").read_text(encoding="utf-8"))


def psets(entity):
    return ifcopenshell.util.element.get_psets(entity)


def by_name(model, entity, name):
    found = [item for item in model.by_type(entity) if item.Name == name]
    assert len(found) == 1, f"{entity} '{name}': {len(found)} ocorrência(s)"
    return found[0]


def polygon_area(points):
    return abs(
        sum(
            points[i]["x"] * points[(i + 1) % len(points)]["y"]
            - points[(i + 1) % len(points)]["x"] * points[i]["y"]
            for i in range(len(points))
        )
        / 2
    )


def test_arquivo_valido_no_esquema(model):
    assert model.schema_identifier == "IFC4X3_ADD2"
    logger = ifcopenshell.validate.json_logger()
    ifcopenshell.validate.validate(model, logger)
    assert logger.statements == []


def test_entidades_e_tipos_predefinidos(model, document):
    elements = document["architecture"]["elements"]
    count = lambda kind: sum(1 for item in elements if item["kind"] == kind)  # noqa: E731
    assert len(model.by_type("IfcWall")) == count("wall") == 5
    assert len(model.by_type("IfcSlab")) == count("slab") == 1
    assert len(model.by_type("IfcCovering")) == count("flooring") == 1
    assert len(model.by_type("IfcDoor")) == count("door") == 2
    assert len(model.by_type("IfcWindow")) == count("window") == 3
    assert len(model.by_type("IfcSpace")) == count("space") == 2
    assert len(model.by_type("IfcRoof")) == count("roof") == 1
    assert {wall.PredefinedType for wall in model.by_type("IfcWall")} == {
        "SOLIDWALL",
        "ELEMENTEDWALL",
    }
    assert model.by_type("IfcSlab")[0].PredefinedType == "FLOOR"
    assert model.by_type("IfcCovering")[0].PredefinedType == "FLOORING"
    # Arquitetura não vira entidade de distribuição nem ganha portas hidráulicas.
    for entity in ("IfcWall", "IfcSlab", "IfcCovering", "IfcRoof", "IfcDoor", "IfcWindow"):
        for item in model.by_type(entity):
            assert not item.is_a("IfcDistributionElement")
            assert not [rel for rel in item.IsNestedBy if rel.RelatedObjects]
    # A instalação hidráulica continua no mesmo arquivo.
    assert len(model.by_type("IfcPipeSegment")) == 2
    assert len(model.by_type("IfcPipeFitting")) == 1


def test_global_ids_preservam_os_identificadores_do_projeto(model, document):
    import uuid

    for element in document["architecture"]["elements"]:
        guid = ifcopenshell.guid.compress(uuid.UUID(element["id"]).hex)
        entity = model.by_guid(guid)
        assert entity.Name in (element["name"], element.get("number"))


def test_tipos_compartilhados_com_classificacao_da_familia(model, document):
    types = {item["id"]: item for item in document["architecture"]["types"]}
    for entity, type_entity in [
        ("IfcWall", "IfcWallType"),
        ("IfcSlab", "IfcSlabType"),
        ("IfcCovering", "IfcCoveringType"),
        ("IfcRoof", "IfcRoofType"),
        ("IfcDoor", "IfcDoorType"),
        ("IfcWindow", "IfcWindowType"),
    ]:
        for item in model.by_type(entity):
            element_type = ifcopenshell.util.element.get_type(item)
            assert element_type is not None and element_type.is_a(type_entity)
            assert element_type.PredefinedType == item.PredefinedType
            assert "Modelo genérico parametrizável" in element_type.Description
    wall_type = by_name(model, "IfcWallType", "Alvenaria cerâmica 18 cm")
    assert len(wall_type.Types[0].RelatedObjects) == 4
    assert len(model.by_type("IfcWallType")) == 2
    assert len(types) == 9
    # Ambientes não têm tipo no modelo.
    assert len(model.by_type("IfcSpaceType")) == 0


def test_portas_e_janelas_tem_atributos_e_modo_de_abertura(model):
    door = by_name(model, "IfcDoor", "Porta 1")
    assert (door.OverallWidth, door.OverallHeight) == (pytest.approx(0.8), pytest.approx(2.1))
    assert door.PredefinedType == "DOOR"
    assert door.OperationType == "SINGLE_SWING_LEFT"
    assert ifcopenshell.util.element.get_type(door).OperationType == "SINGLE_SWING_LEFT"
    sliding = by_name(model, "IfcDoor", "Porta 2")
    assert sliding.OperationType == "SLIDING_TO_RIGHT"
    window = by_name(model, "IfcWindow", "Janela 1")
    assert (window.OverallWidth, window.OverallHeight) == (pytest.approx(1.2), pytest.approx(1.0))
    assert window.PartitioningType == "DOUBLE_PANEL_VERTICAL"
    panels = [
        item
        for item in ifcopenshell.util.element.get_type(window).HasPropertySets
        if item.is_a("IfcWindowPanelProperties")
    ]
    assert [(p.OperationType, p.PanelPosition) for p in panels] == [
        ("SLIDINGHORIZONTAL", "LEFT"),
        ("SLIDINGHORIZONTAL", "RIGHT"),
    ]
    top_hung = by_name(model, "IfcWindow", "Janela 3")
    assert top_hung.PartitioningType == "SINGLE_PANEL"


def test_vaos_reais_ligados_a_parede_e_a_esquadria(model):
    openings = model.by_type("IfcOpeningElement")
    # Cinco esquadrias e duas aberturas de piso (laje e revestimento).
    assert len(openings) == 7
    assert len(model.by_type("IfcRelVoidsElement")) == 7
    fills = model.by_type("IfcRelFillsElement")
    assert len(fills) == 5
    for rel in fills:
        filler = rel.RelatedBuildingElement
        assert filler.is_a("IfcDoor") or filler.is_a("IfcWindow")
        host = rel.RelatingOpeningElement.VoidsElements[0].RelatingBuildingElement
        assert host.is_a("IfcWall")
    wall = by_name(model, "IfcWall", "Parede 1")
    assert len(wall.HasOpenings) == 2
    for entity in ("IfcSlab", "IfcCovering"):
        floor = model.by_type(entity)[0]
        assert len(floor.HasOpenings) == 1
        assert not floor.HasOpenings[0].RelatedOpeningElement.HasFillings


def test_ambientes_sao_elementos_espaciais_do_pavimento(model, document):
    storey = by_name(model, "IfcBuildingStorey", "Térreo")
    spaces = [obj for rel in storey.IsDecomposedBy for obj in rel.RelatedObjects]
    assert sorted(space.LongName for space in spaces) == ["Banheiro", "Sala"]
    for space in spaces:
        assert space.is_a("IfcSpatialElement")
        assert space.PredefinedType == "SPACE"
    sala = next(space for space in spaces if space.LongName == "Sala")
    source = next(
        item
        for item in document["architecture"]["elements"]
        if item["kind"] == "space" and item["name"] == "Sala"
    )
    quantities = psets(sala)["Qto_SpaceBaseQuantities"]
    assert quantities["GrossFloorArea"] == pytest.approx(polygon_area(source["boundary"]))
    assert quantities["Height"] == pytest.approx(2.6)
    assert quantities["GrossVolume"] == pytest.approx(polygon_area(source["boundary"]) * 2.6)
    # Pé-direito não informado: sem altura, sem volume e sem sólido — nada é presumido.
    banheiro = next(space for space in spaces if space.LongName == "Banheiro")
    pending = psets(banheiro)["Qto_SpaceBaseQuantities"]
    assert "Height" not in pending and "GrossVolume" not in pending
    identifiers = {rep.RepresentationIdentifier for rep in banheiro.Representation.Representations}
    assert identifiers == {"FootPrint"}
    # Elementos físicos ficam contidos no pavimento.
    contained = [obj for rel in storey.ContainsElements for obj in rel.RelatedElements]
    assert sum(1 for obj in contained if obj.is_a("IfcWall")) == 5
    assert not [obj for obj in contained if obj.is_a("IfcSpace")]


def test_camadas_de_material_no_tipo_e_uso_na_ocorrencia(model, document):
    source = next(
        item
        for item in document["architecture"]["types"]
        if item["name"] == "Alvenaria cerâmica 18 cm"
    )
    wall_type = by_name(model, "IfcWallType", "Alvenaria cerâmica 18 cm")
    layer_set = ifcopenshell.util.element.get_material(wall_type)
    assert layer_set.is_a("IfcMaterialLayerSet")
    assert [
        (layer.Material.Name, pytest.approx(layer.LayerThickness))
        for layer in layer_set.MaterialLayers
    ] == [(layer["material"], layer["thickness"]) for layer in source["layers"]]
    wall = by_name(model, "IfcWall", "Parede 1")
    usage = ifcopenshell.util.element.get_material(wall, should_inherit=False)
    assert usage.is_a("IfcMaterialLayerSetUsage")
    assert usage.ForLayerSet == layer_set
    assert (usage.LayerSetDirection, usage.DirectionSense) == ("AXIS2", "NEGATIVE")
    assert usage.OffsetFromReferenceLine == pytest.approx(0.09)
    slab = model.by_type("IfcSlab")[0]
    slab_usage = ifcopenshell.util.element.get_material(slab, should_inherit=False)
    assert slab_usage.LayerSetDirection == "AXIS3"


def test_propriedades_pendentes_ficam_sem_valor(model):
    """Campo disponível não é valor conhecido: nada vira zero, falso ou desempenho presumido."""
    wall = by_name(model, "IfcWall", "Parede 1")
    for definition in [
        rel.RelatingPropertyDefinition
        for rel in wall.IsDefinedBy
        if rel.is_a("IfcRelDefinesByProperties")
    ] + list(ifcopenshell.util.element.get_type(wall).HasPropertySets):
        if not definition.is_a("IfcPropertySet") or not definition.Name.startswith("Pset_"):
            continue
        for prop in definition.HasProperties:
            if definition.Name.endswith("Common") and prop.Name == "Reference":
                assert prop.NominalValue.wrappedValue == "Alvenaria cerâmica 18 cm"
            elif prop.is_a("IfcPropertyEnumeratedValue"):
                assert prop.EnumerationValues is None
            else:
                assert prop.NominalValue is None, f"{definition.Name}.{prop.Name}"
    common = [
        item
        for item in ifcopenshell.util.element.get_type(wall).HasPropertySets
        if item.Name == "Pset_WallCommon"
    ][0]
    assert {"FireRating", "AcousticRating", "ThermalTransmittance"} <= {
        prop.Name for prop in common.HasProperties
    }


def test_unidades(model):
    units = model.by_type("IfcUnitAssignment")[0].Units
    named = {unit.UnitType: unit for unit in units}
    assert named["LENGTHUNIT"].Name == "METRE" and named["LENGTHUNIT"].Prefix is None
    assert named["AREAUNIT"].Name == "SQUARE_METRE"
    assert named["VOLUMEUNIT"].Name == "CUBIC_METRE"
    transmittance = named["THERMALTRANSMITTANCEUNIT"]
    assert sorted((item.Unit.UnitType, item.Exponent) for item in transmittance.Elements) == [
        ("MASSUNIT", 1),
        ("THERMODYNAMICTEMPERATUREUNIT", -1),
        ("TIMEUNIT", -3),
    ]


def test_quantitativos_bruto_e_liquido_com_desconto_dos_vaos(model):
    wall = by_name(model, "IfcWall", "Parede 1")
    q = psets(wall)["Qto_WallBaseQuantities"]
    # Parede sul: eixo de 6 m, 18 cm, 2,80 m; porta 0,80 × 2,10 e janela 1,20 × 1,00.
    assert q["Length"] == pytest.approx(6.0)
    assert q["Width"] == pytest.approx(0.18)
    assert q["Height"] == pytest.approx(2.8)
    assert q["GrossSideArea"] == pytest.approx(6.0 * 2.8)
    assert q["NetSideArea"] == pytest.approx(6.0 * 2.8 - 0.8 * 2.1 - 1.2 * 1.0)
    assert q["GrossVolume"] == pytest.approx(6.0 * 0.18 * 2.8)
    assert q["NetVolume"] == pytest.approx(6.0 * 0.18 * 2.8 - (0.8 * 2.1 + 1.2 * 1.0) * 0.18)
    assert q["GrossFootPrintArea"] == pytest.approx(6.0 * 0.18)
    assert q["NetFootPrintArea"] == pytest.approx(6.0 * 0.18 - 0.8 * 0.18)

    slab = psets(model.by_type("IfcSlab")[0])["Qto_SlabBaseQuantities"]
    assert slab["Width"] == pytest.approx(0.12)
    assert slab["GrossArea"] == pytest.approx(24.0)
    assert slab["NetArea"] == pytest.approx(24.0 - 0.16)
    assert slab["NetVolume"] == pytest.approx((24.0 - 0.16) * 0.12)
    assert "Length" not in slab and "Depth" not in slab

    covering = psets(model.by_type("IfcCovering")[0])["Qto_CoveringBaseQuantities"]
    assert covering["Width"] == pytest.approx(0.05)
    assert covering["NetArea"] == pytest.approx(covering["GrossArea"] - 0.16)

    door = psets(by_name(model, "IfcDoor", "Porta 1"))["Qto_DoorBaseQuantities"]
    assert door == {
        "id": door["id"],
        "Width": pytest.approx(0.8),
        "Height": pytest.approx(2.1),
        "Perimeter": pytest.approx(5.8),
        "Area": pytest.approx(1.68),
    }


def test_geometria_tesselada_subtrai_os_vaos(model):
    """O sólido que um visualizador mostra tem o volume LÍQUIDO gravado nas quantidades."""
    settings = ifcopenshell.geom.settings()
    for entity, quantity_set in [
        ("IfcWall", "Qto_WallBaseQuantities"),
        ("IfcSlab", "Qto_SlabBaseQuantities"),
    ]:
        for item in model.by_type(entity):
            shape = ifcopenshell.geom.create_shape(settings, item)
            volume = ifcopenshell.util.shape.get_volume(shape.geometry)
            expected = psets(item)[quantity_set]["NetVolume"]
            assert math.isclose(volume, expected, rel_tol=2e-3), f"{item.Name}: {volume}"
    for entity in ("IfcDoor", "IfcWindow"):
        for item in model.by_type(entity):
            shape = ifcopenshell.geom.create_shape(settings, item)
            assert len(shape.geometry.faces) > 0


def test_telhado_de_duas_aguas(model, document):
    """IfcRoof com corpo próprio: tipologia, cotas, áreas e volume conferidos com o projeto."""
    source = next(item for item in document["architecture"]["elements"] if item["kind"] == "roof")
    roof_type = next(
        item for item in document["architecture"]["types"] if item["id"] == source["typeId"]
    )
    roof = model.by_type("IfcRoof")[0]
    assert roof.Name == source["name"]
    assert roof.PredefinedType == "GABLE_ROOF" and roof_type["shape"] == "gable"
    element_type = ifcopenshell.util.element.get_type(roof)
    assert element_type.is_a("IfcRoofType") and element_type.PredefinedType == "GABLE_ROOF"
    # Contido no pavimento do seu nível (Cobertura), não no térreo.
    storey = by_name(model, "IfcBuildingStorey", "Cobertura")
    contained = [obj for rel in storey.ContainsElements for obj in rel.RelatedElements]
    assert roof in contained

    # Contorno de 6,18 × 4,18 m, beiral de 0,50 m nos quatro lados, inclinação de 30 %.
    slope = source["slope"]
    assert math.tan(slope) == pytest.approx(0.30)
    side_a = math.dist(
        (source["boundary"][0]["x"], source["boundary"][0]["y"]),
        (source["boundary"][1]["x"], source["boundary"][1]["y"]),
    )
    side_b = math.dist(
        (source["boundary"][1]["x"], source["boundary"][1]["y"]),
        (source["boundary"][2]["x"], source["boundary"][2]["y"]),
    )
    overhang = source["overhang"]
    projected = (side_a + 2 * overhang) * (side_b + 2 * overhang)
    thickness = sum(layer["thickness"] for layer in roof_type["layers"])
    sets = psets(roof)
    quantities = sets["Qto_RoofBaseQuantities"]
    # Área inclinada (bruta = líquida: sem aberturas) e projeção horizontal são distintas.
    assert quantities["ProjectedArea"] == pytest.approx(projected)
    assert quantities["GrossArea"] == pytest.approx(projected / math.cos(slope))
    assert quantities["NetArea"] == pytest.approx(quantities["GrossArea"])
    assert quantities["GrossArea"] > quantities["ProjectedArea"]
    own = sets["HydroBIM_Telhado"]
    assert own["Slope"] == pytest.approx(slope)
    assert own["Overhang"] == pytest.approx(overhang)
    assert own["Volume"] == pytest.approx(quantities["GrossArea"] * thickness)
    assert own["RidgeLength"] == pytest.approx(side_a + 2 * overhang)
    # Propriedades de desempenho continuam pendentes: nada é presumido.
    common = sets.get("Pset_RoofCommon", {})
    for name in ("FireRating", "ThermalTransmittance", "AcousticRating", "IsExternal"):
        assert common.get(name) is None

    # O sólido tesselado tem o volume gravado e fica entre as cotas derivadas.
    settings = ifcopenshell.geom.settings()
    settings.set("use-world-coords", True)
    shape = ifcopenshell.geom.create_shape(settings, roof)
    assert ifcopenshell.util.shape.get_volume(shape.geometry) == pytest.approx(
        own["Volume"], rel=1e-4
    )
    zs = shape.geometry.verts[2::3]
    level = next(item for item in document["levels"] if item["id"] == source["levelId"])
    reference = level["elevation"] + source["offset"]
    vertical = thickness / math.cos(slope)
    assert min(zs) == pytest.approx(reference - overhang * math.tan(slope), abs=1e-6)
    assert max(zs) == pytest.approx(reference + side_b / 2 * math.tan(slope) + vertical, abs=1e-6)
    position = sets["HydroBIM_Posicao"]
    assert position["BaseElevation"] == pytest.approx(min(zs), abs=1e-6)
    assert position["TopElevation"] == pytest.approx(max(zs), abs=1e-6)

    # As camadas vão no tipo; a água inclinada não tem uso de camadas por eixo.
    layer_set = ifcopenshell.util.element.get_material(element_type)
    assert layer_set.is_a("IfcMaterialLayerSet")
    assert [layer.Material.Name for layer in layer_set.MaterialLayers] == [
        layer["material"] for layer in roof_type["layers"]
    ]
    assert ifcopenshell.util.element.get_material(roof, should_inherit=False) is None


def test_posicao_da_parede_e_do_vao(model):
    import ifcopenshell.util.placement

    wall = by_name(model, "IfcWall", "Parede 2")
    matrix = ifcopenshell.util.placement.get_local_placement(wall.ObjectPlacement)
    # Parede leste: começa em (6, 0, 0) e segue em +Y.
    assert [matrix[i][3] for i in range(3)] == pytest.approx([6.0, 0.0, 0.0])
    assert [matrix[i][0] for i in range(3)] == pytest.approx([0.0, 1.0, 0.0], abs=1e-9)
    door = by_name(model, "IfcDoor", "Porta 1")
    placed = ifcopenshell.util.placement.get_local_placement(door.ObjectPlacement)
    assert [placed[i][3] for i in range(3)] == pytest.approx([1.2, 0.0, 0.0])
