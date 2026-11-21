"""Camada BIM do IFC exportado, conferida contra as definições oficiais do IFC 4.3.

Os modelos de conjuntos de propriedades da buildingSMART vêm do IfcOpenShell
(`ifcopenshell.util.pset`): todo `Pset_*`/`Qto_*` gravado precisa existir no esquema, ser
aplicável à entidade a que está ligado e trazer só propriedades — com o tipo de valor e a
enumeração — que o esquema define.
"""

import json
import math
import re
import uuid
from pathlib import Path

import ifcopenshell
import ifcopenshell.util.pset
import pytest

EXAMPLES = sorted((Path(__file__).resolve().parents[3] / "examples").glob("*.ifc"))
PARAMETERS = EXAMPLES or [
    pytest.param(None, marks=pytest.mark.skip(reason="Nenhum IFC em examples/."))
]
IDS = [path.name for path in EXAMPLES] or ["sem-exemplos"]
TEMPLATES = ifcopenshell.util.pset.get_template("IFC4X3")
# Conjunto próprio do fabricante do reservatório: usa o prefixo `Pset_` por requisito do
# projeto (docs/IFC_MAPPING.md); não é um conjunto padronizado.
MANUFACTURER_SET = re.compile(r"^Pset_[A-Za-z0-9]+_Reservatorio$")
QUANTITY_KINDS = {
    "Q_LENGTH": "IfcQuantityLength",
    "Q_AREA": "IfcQuantityArea",
    "Q_VOLUME": "IfcQuantityVolume",
    "Q_COUNT": "IfcQuantityCount",
    "Q_WEIGHT": "IfcQuantityWeight",
}


def global_id(identifier):
    try:
        value = uuid.UUID(identifier)
    except ValueError:
        value = uuid.uuid5(uuid.UUID(int=0), f"HydroBIM:{identifier}:legacy")
    return ifcopenshell.guid.compress(value.hex)


def source_document(path):
    return json.loads(path.with_suffix(".hydrobim.json").read_text(encoding="utf-8"))


def owners(definition):
    """Objetos a que um conjunto está ligado: ocorrências, portas ou tipos."""
    found = [obj for rel in definition.DefinesOccurrence for obj in rel.RelatedObjects]
    return found + list(definition.DefinesType)


def applicable(template, entity):
    predefined = getattr(entity, "PredefinedType", None)
    for item in template.ApplicableEntity.split(","):
        name, _, required = item.partition("/")
        if entity.is_a(name) and (not required or required == predefined):
            return True
    return False


@pytest.mark.parametrize("example", PARAMETERS, ids=IDS)
def test_standard_sets_follow_the_ifc43_templates(example):
    model = ifcopenshell.open(str(example))
    checked = set()
    for definition in model.by_type("IfcPropertySetDefinition"):
        # Conjuntos predefinidos do esquema (`IfcWindowPanelProperties` das folhas de janela
        # etc.) são entidades com atributos próprios e nome livre: não seguem os modelos.
        if definition.is_a("IfcPreDefinedPropertySet"):
            continue
        name = definition.Name
        template = TEMPLATES.get_by_name(name)
        if template is None:
            # Fora do esquema, só conjuntos próprios — nunca um nome com prefixo reservado.
            assert name.startswith("HydroBIM_") or MANUFACTURER_SET.match(name), name
            continue
        checked.add(name)
        related = owners(definition)
        assert related, name
        for entity in related:
            assert applicable(template, entity), f"{name} não se aplica a {entity.is_a()}"
        templates = {p.Name: p for p in template.HasPropertyTemplates}
        members = (
            definition.Quantities
            if definition.is_a("IfcElementQuantity")
            else definition.HasProperties
        )
        assert members, name
        for member in members:
            where = f"{name}.{member.Name}"
            assert member.Name in templates, f"{where} não existe no IFC 4.3"
            expected = templates[member.Name]
            if definition.is_a("IfcElementQuantity"):
                assert member.is_a(QUANTITY_KINDS[expected.TemplateType]), where
            elif expected.TemplateType == "P_ENUMERATEDVALUE":
                assert member.is_a("IfcPropertyEnumeratedValue"), where
                allowed = {v.wrappedValue for v in expected.Enumerators.EnumerationValues}
                assert member.EnumerationReference.Name == expected.Enumerators.Name, where
                for value in member.EnumerationValues or ():
                    assert value.wrappedValue in allowed, where
            else:
                assert expected.TemplateType == "P_SINGLEVALUE", where
                assert member.is_a("IfcPropertySingleValue"), where
                if member.NominalValue is not None:
                    assert member.NominalValue.is_a(expected.PrimaryMeasureType), where
    assert {"Pset_ManufacturerTypeInformation", "Pset_DistributionPortTypePipe"} <= checked


@pytest.mark.parametrize("example", PARAMETERS, ids=IDS)
def test_every_element_has_type_material_and_system(example):
    model = ifcopenshell.open(str(example))
    document = source_document(example)
    for source in document["elements"]:
        entity = model.by_guid(global_id(source["id"]))
        assert len(entity.IsTypedBy) == 1, source["name"]
        element_type = entity.IsTypedBy[0].RelatingType
        assert element_type.is_a() == f"{entity.is_a()}Type"
        assert element_type.PredefinedType == entity.PredefinedType
        assert element_type.Name
        materials = [a for a in entity.HasAssociations if a.is_a("IfcRelAssociatesMaterial")]
        assert len(materials) == 1
        assert any(a.is_a("IfcRelAssociatesMaterial") for a in element_type.HasAssociations)
        groups = [a.RelatingGroup for a in entity.HasAssignments if a.is_a("IfcRelAssignsToGroup")]
        assert [g.is_a() for g in groups] == ["IfcDistributionSystem"]
    # Elementos do mesmo produto compartilham o tipo: há menos tipos que ocorrências.
    # A conta vale para os tipos da rede; os de arquitetura (`IfcWallType` etc.) tipificam
    # ocorrências que não estão em `elements`.
    types = model.by_type("IfcDistributionElementType")
    assert 0 < len(types) <= len(document["elements"])
    assert all(t.Types and t.Types[0].RelatedObjects for t in model.by_type("IfcElementType"))


def _values(definition):
    if definition.is_a("IfcElementQuantity"):
        return {q.Name: q[3] for q in definition.Quantities}
    return {
        p.Name: (
            p.NominalValue.wrappedValue
            if p.is_a("IfcPropertySingleValue") and p.NominalValue is not None
            else p.EnumerationValues[0].wrappedValue
            if p.is_a("IfcPropertyEnumeratedValue") and p.EnumerationValues
            else None
        )
        for p in definition.HasProperties
    }


def _occurrence_sets(entity):
    return {
        r.RelatingPropertyDefinition.Name: _values(r.RelatingPropertyDefinition)
        for r in entity.IsDefinedBy
    }


def _type_sets(entity):
    return {s.Name: _values(s) for s in entity.IsTypedBy[0].RelatingType.HasPropertySets or ()}


@pytest.mark.parametrize("example", PARAMETERS, ids=IDS)
def test_pipes_keep_parameters_and_quantities(example):
    """Reabre o IFC e confere, contra o projeto, os dados de tubos e de suas portas."""
    model = ifcopenshell.open(str(example))
    for source in (e for e in source_document(example)["elements"] if e["kind"] == "pipe"):
        entity = model.by_guid(global_id(source["id"]))
        spec = source["spec"]
        length = math.dist(list(source["start"].values()), list(source["end"].values()))
        common = _type_sets(entity)["Pset_PipeSegmentTypeCommon"]
        assert common["NominalDiameter"] == pytest.approx(spec["dn"] / 1000)
        assert common["OuterDiameter"] == pytest.approx(spec["outerDiameter"])
        assert common["InnerDiameter"] == pytest.approx(spec["innerDiameter"])
        # Pressão de serviço: exigida pelo perfil do projeto, mas não informada — sem valor.
        assert common["WorkingPressure"] is None
        occurrence = _occurrence_sets(entity)
        assert occurrence["Pset_PipeSegmentTypeCommon"]["Length"] == pytest.approx(length)
        quantities = occurrence["Qto_PipeSegmentBaseQuantities"]
        assert quantities["Length"] == pytest.approx(length)
        assert quantities["GrossCrossSectionArea"] == pytest.approx(
            math.pi * spec["outerDiameter"] ** 2 / 4
        )
        assert quantities["OuterSurfaceArea"] == pytest.approx(
            math.pi * spec["outerDiameter"] * length
        )
        layout = occurrence["HydroBIM_Tracado"]
        assert layout["StartElevation"] == pytest.approx(source["start"]["z"])
        assert layout["EndElevation"] == pytest.approx(source["end"]["z"])
        for port in entity.IsNestedBy[0].RelatedObjects:
            pipe = _occurrence_sets(port)["Pset_DistributionPortTypePipe"]
            assert pipe["OuterDiameter"] == pytest.approx(spec["outerDiameter"])
            assert pipe["ConnectionType"] in {"FLANGED", "THREADED", "WELDED", "OTHER"}


@pytest.mark.parametrize("example", PARAMETERS, ids=IDS)
def test_connected_ports_coincide(example):
    """As portas ligadas por IfcRelConnectsPorts estão no mesmo ponto do modelo."""
    import ifcopenshell.util.placement as placement

    model = ifcopenshell.open(str(example))
    relations = model.by_type("IfcRelConnectsPorts")
    for relation in relations:
        a = placement.get_local_placement(relation.RelatingPort.ObjectPlacement)
        b = placement.get_local_placement(relation.RelatedPort.ObjectPlacement)
        assert math.dist(a[:3, 3], b[:3, 3]) < 1e-3
        # Eixos Z das portas apontam para fora dos elementos: sentidos opostos.
        assert sum(a[i, 2] * b[i, 2] for i in range(3)) == pytest.approx(-1, abs=1e-3)
