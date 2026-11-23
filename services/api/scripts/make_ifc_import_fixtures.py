"""Gera os arquivos IFC de teste da importação e os valores de conferência.

Os arquivos são escritos pelo IfcOpenShell (implementação independente do leitor usado no
editor, o web-ifc) e descrevem a mesma edificação em três esquemas e quatro unidades:

- ``predio-ifc2x3-m.ifc``  — IFC2X3, metros, ângulos em graus;
- ``predio-ifc4-mm.ifc``   — IFC4, milímetros, com ``IfcMapConversion`` declarado;
- ``predio-ifc4x3-m.ifc``  — IFC4X3_ADD2, metros, com coordenadas locais grandes;
- ``predio-ifc4-pe.ifc``   — IFC4, pés (unidade por conversão).

Para cada arquivo é gravado ``<nome>.expected.json`` com o que o IfcOpenShell lê dele: caixa
envolvente e volume de cada produto com geometria (em metros, coordenadas globais), pavimento,
tipo, materiais, conjuntos de propriedades e quantidades. O teste de integração do leitor
(`tests/integration/ifcImport.test.ts`) compara o resultado do web-ifc com esses valores, e
`services/api/tests/test_ifc_import_fixtures.py` confere que os arquivos gravados continuam
iguais ao que o IfcOpenShell produz.

Origem e licença: arquivos sintéticos, gerados por este script do próprio projeto; não derivam
de modelos de terceiros.

Uso (em services/api): uv run python scripts/make_ifc_import_fixtures.py
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from math import cos, radians, sin
from pathlib import Path

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.guid
import ifcopenshell.util.element
import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[3]
OUT = REPO_ROOT / "tests" / "fixtures" / "ifc-import"
NAMESPACE = uuid.UUID("7d5e6a7e-3b5c-4b77-9a51-0f1d2c3b4a59")


@dataclass(frozen=True)
class Variant:
    file_name: str
    schema: str
    # Quantos metros vale uma unidade de comprimento do arquivo.
    unit_scale: float
    degrees: bool
    # Posição do terreno (IfcSite) no sistema local do arquivo, em metros.
    site_origin: tuple[float, float, float]
    map_conversion: bool


VARIANTS = (
    Variant("predio-ifc2x3-m.ifc", "IFC2X3", 1.0, True, (100.0, 50.0, 10.0), False),
    Variant("predio-ifc4-mm.ifc", "IFC4", 0.001, False, (100.0, 50.0, 10.0), True),
    Variant("predio-ifc4x3-m.ifc", "IFC4X3_ADD2", 1.0, False, (350000.0, 7400000.0, 400.0), False),
    Variant("predio-ifc4-pe.ifc", "IFC4", 0.3048, False, (100.0, 50.0, 10.0), False),
)

# Giro do edifício em relação ao terreno (em torno de Z).
BUILDING_ROTATION_DEG = 30.0
BUILDING_OFFSET = (5.0, 2.0, 0.0)


class Builder:
    def __init__(self, variant: Variant) -> None:
        self.v = variant
        self.f = ifcopenshell.file(schema=variant.schema)
        self.is2x3 = variant.schema == "IFC2X3"
        self._guid_count = 0
        f = self.f
        person = f.create_entity("IfcPerson", FamilyName="HydroBIM")
        org = f.create_entity("IfcOrganization", Name="HydroBIM")
        pao = f.create_entity("IfcPersonAndOrganization", ThePerson=person, TheOrganization=org)
        app = f.create_entity(
            "IfcApplication",
            ApplicationDeveloper=org,
            Version="1",
            ApplicationFullName="Gerador de fixtures do HydroBIM",
            ApplicationIdentifier="hydrobim-fixtures",
        )
        self.history = f.create_entity(
            "IfcOwnerHistory",
            OwningUser=pao,
            OwningApplication=app,
            ChangeAction="ADDED" if not self.is2x3 else "ADDED",
            CreationDate=1767225600,
        )
        self.origin = f.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0))
        self.context = f.create_entity(
            "IfcGeometricRepresentationContext",
            ContextType="Model",
            CoordinateSpaceDimension=3,
            Precision=1e-5,
            WorldCoordinateSystem=f.create_entity("IfcAxis2Placement3D", Location=self.origin),
        )
        self.body = f.create_entity(
            "IfcGeometricRepresentationSubContext",
            ContextIdentifier="Body",
            ContextType="Model",
            ParentContext=self.context,
            TargetView="MODEL_VIEW",
        )
        self.axis = f.create_entity(
            "IfcGeometricRepresentationSubContext",
            ContextIdentifier="Axis",
            ContextType="Model",
            ParentContext=self.context,
            TargetView="GRAPH_VIEW",
        )
        self.units = self._units()
        self.project = f.create_entity(
            "IfcProject",
            GlobalId=self.guid("project"),
            OwnerHistory=self.history,
            Name="Prédio de teste da importação",
            RepresentationContexts=[self.context],
            UnitsInContext=self.units,
        )

    # --- utilitários ---------------------------------------------------------------

    def guid(self, role: str) -> str:
        return ifcopenshell.guid.compress(uuid.uuid5(NAMESPACE, role).hex)

    def length(self, metres: float) -> float:
        return metres / self.v.unit_scale

    def point(self, xyz: tuple[float, float, float]):
        return self.f.create_entity(
            "IfcCartesianPoint", Coordinates=tuple(self.length(c) for c in xyz)
        )

    def direction(self, xyz: tuple[float, ...]):
        return self.f.create_entity("IfcDirection", DirectionRatios=tuple(float(c) for c in xyz))

    def axis2(self, location=(0.0, 0.0, 0.0), z=None, x=None):
        return self.f.create_entity(
            "IfcAxis2Placement3D",
            Location=self.point(location),
            Axis=self.direction(z) if z else None,
            RefDirection=self.direction(x) if x else None,
        )

    def placement(self, relative_to, location=(0.0, 0.0, 0.0), z=None, x=None):
        return self.f.create_entity(
            "IfcLocalPlacement",
            PlacementRelTo=relative_to,
            RelativePlacement=self.axis2(location, z, x),
        )

    def _units(self):
        f = self.f
        length = f.create_entity(
            "IfcSIUnit",
            UnitType="LENGTHUNIT",
            Prefix="MILLI" if self.v.unit_scale == 0.001 else None,
            Name="METRE",
        )
        if self.v.unit_scale not in (1.0, 0.001):
            # Unidade por conversão (pé), como nos arquivos de origem imperial.
            length = f.create_entity(
                "IfcConversionBasedUnit",
                Dimensions=f.create_entity("IfcDimensionalExponents", 1, 0, 0, 0, 0, 0, 0),
                UnitType="LENGTHUNIT",
                Name="FOOT",
                ConversionFactor=f.create_entity(
                    "IfcMeasureWithUnit",
                    ValueComponent=f.create_entity("IfcLengthMeasure", self.v.unit_scale),
                    UnitComponent=length,
                ),
            )
        area = f.create_entity("IfcSIUnit", UnitType="AREAUNIT", Name="SQUARE_METRE")
        volume = f.create_entity("IfcSIUnit", UnitType="VOLUMEUNIT", Name="CUBIC_METRE")
        radian = f.create_entity("IfcSIUnit", UnitType="PLANEANGLEUNIT", Name="RADIAN")
        angle = radian
        if self.v.degrees:
            angle = f.create_entity(
                "IfcConversionBasedUnit",
                Dimensions=f.create_entity("IfcDimensionalExponents", 0, 0, 0, 0, 0, 0, 0),
                UnitType="PLANEANGLEUNIT",
                Name="DEGREE",
                ConversionFactor=f.create_entity(
                    "IfcMeasureWithUnit",
                    ValueComponent=f.create_entity("IfcPlaneAngleMeasure", radians(1.0)),
                    UnitComponent=radian,
                ),
            )
        return f.create_entity("IfcUnitAssignment", Units=[length, area, volume, angle])

    def rel(self, entity: str, role: str, **attrs):
        return self.f.create_entity(
            entity, GlobalId=self.guid(f"rel:{role}"), OwnerHistory=self.history, **attrs
        )

    # --- geometria -----------------------------------------------------------------

    def box(self, size, centre_xy=(0.0, 0.0), base=(0.0, 0.0, 0.0)):
        """Paralelepípedo: perfil retangular centrado em `centre_xy`, extrudado em +Z."""
        f = self.f
        profile = f.create_entity(
            "IfcRectangleProfileDef",
            ProfileType="AREA",
            Position=f.create_entity(
                "IfcAxis2Placement2D",
                Location=f.create_entity(
                    "IfcCartesianPoint",
                    Coordinates=(self.length(centre_xy[0]), self.length(centre_xy[1])),
                ),
            ),
            XDim=self.length(size[0]),
            YDim=self.length(size[1]),
        )
        return f.create_entity(
            "IfcExtrudedAreaSolid",
            SweptArea=profile,
            Position=self.axis2(base),
            ExtrudedDirection=self.direction((0.0, 0.0, 1.0)),
            Depth=self.length(size[2]),
        )

    def shape(self, items, rep_type="SweptSolid"):
        f = self.f
        rep = f.create_entity(
            "IfcShapeRepresentation",
            ContextOfItems=self.body,
            RepresentationIdentifier="Body",
            RepresentationType=rep_type,
            Items=list(items),
        )
        return f.create_entity("IfcProductDefinitionShape", Representations=[rep]), rep

    # --- propriedades --------------------------------------------------------------

    def single(self, name: str, value_type: str, value, unit=None):
        return self.f.create_entity(
            "IfcPropertySingleValue",
            Name=name,
            NominalValue=self.f.create_entity(value_type, value),
            Unit=unit,
        )

    def pset(self, role: str, name: str, properties):
        return self.f.create_entity(
            "IfcPropertySet",
            GlobalId=self.guid(f"pset:{role}:{name}"),
            OwnerHistory=self.history,
            Name=name,
            HasProperties=list(properties),
        )

    def assign_pset(self, role: str, product, pset):
        self.rel(
            "IfcRelDefinesByProperties",
            f"props:{role}:{pset.Name}",
            RelatedObjects=[product],
            RelatingPropertyDefinition=pset,
        )


def build(variant: Variant) -> ifcopenshell.file:
    b = Builder(variant)
    f = b.f
    is2x3 = b.is2x3

    # --- estrutura espacial ---------------------------------------------------------
    site_placement = b.placement(None, variant.site_origin)
    site = f.create_entity(
        "IfcSite",
        GlobalId=b.guid("site"),
        OwnerHistory=b.history,
        Name="Terreno",
        ObjectPlacement=site_placement,
        CompositionType="ELEMENT",
    )
    rot = radians(BUILDING_ROTATION_DEG)
    building_placement = b.placement(
        site_placement, BUILDING_OFFSET, z=(0, 0, 1), x=(cos(rot), sin(rot), 0)
    )
    building = f.create_entity(
        "IfcBuilding",
        GlobalId=b.guid("building"),
        OwnerHistory=b.history,
        Name="Bloco A",
        ObjectPlacement=building_placement,
        CompositionType="ELEMENT",
    )
    storey0_placement = b.placement(building_placement, (0, 0, 0))
    storey0 = f.create_entity(
        "IfcBuildingStorey",
        GlobalId=b.guid("storey0"),
        OwnerHistory=b.history,
        Name="Térreo",
        ObjectPlacement=storey0_placement,
        CompositionType="ELEMENT",
        Elevation=b.length(0.0),
    )
    storey1_placement = b.placement(building_placement, (0, 0, 3.0))
    storey1 = f.create_entity(
        "IfcBuildingStorey",
        GlobalId=b.guid("storey1"),
        OwnerHistory=b.history,
        Name="Pavimento 1",
        ObjectPlacement=storey1_placement,
        CompositionType="ELEMENT",
        Elevation=b.length(3.0),
    )
    b.rel("IfcRelAggregates", "project", RelatingObject=b.project, RelatedObjects=[site])
    b.rel("IfcRelAggregates", "site", RelatingObject=site, RelatedObjects=[building])
    b.rel(
        "IfcRelAggregates", "building", RelatingObject=building, RelatedObjects=[storey0, storey1]
    )

    if variant.map_conversion:
        crs = f.create_entity(
            "IfcProjectedCRS",
            Name="EPSG:31982",
            Description="SIRGAS 2000 / UTM zone 22S",
            GeodeticDatum="SIRGAS 2000",
            MapProjection="UTM",
            MapZone="22S",
        )
        f.create_entity(
            "IfcMapConversion",
            SourceCRS=b.context,
            TargetCRS=crs,
            Eastings=333000.0,
            Northings=7394000.0,
            OrthogonalHeight=760.0,
            XAxisAbscissa=cos(radians(15.0)),
            XAxisOrdinate=sin(radians(15.0)),
            Scale=0.001,
        )

    # --- tipo de parede, com propriedades de tipo --------------------------------------
    wall_type = f.create_entity(
        "IfcWallType",
        GlobalId=b.guid("walltype"),
        OwnerHistory=b.history,
        Name="Parede de alvenaria 20 cm",
        HasPropertySets=[
            b.pset(
                "walltype",
                "Pset_WallCommon",
                [
                    b.single("Reference", "IfcIdentifier", "TIPO-20"),
                    b.single("AcousticRating", "IfcLabel", "45 dB"),
                ],
            )
        ],
        PredefinedType="STANDARD" if is2x3 else "SOLIDWALL",
    )

    # --- parede A, com vão, propriedades, quantidades, material e classificação --------
    wall_a_placement = b.placement(storey0_placement, (0, 0, 0))
    wall_a_solid = b.box((4.0, 0.2, 2.8), centre_xy=(2.0, 0.0))
    wall_a_shape, _ = b.shape([wall_a_solid])
    # Cor de apresentação declarada no arquivo (o leitor deve devolvê-la, não inventar outra).
    surface_style = f.create_entity(
        "IfcSurfaceStyle",
        Name="Tijolo",
        Side="BOTH",
        Styles=[
            f.create_entity(
                "IfcSurfaceStyleShading",
                SurfaceColour=f.create_entity("IfcColourRgb", Red=0.8, Green=0.4, Blue=0.2),
            )
        ],
    )
    f.create_entity(
        "IfcStyledItem",
        Item=wall_a_solid,
        Styles=[
            surface_style
            if variant.schema == "IFC4X3_ADD2"
            else f.create_entity("IfcPresentationStyleAssignment", Styles=[surface_style])
        ],
    )
    wall_a = f.create_entity(
        "IfcWall",
        GlobalId=b.guid("wall-a"),
        OwnerHistory=b.history,
        Name="Parede A",
        Description="Parede externa com vão de porta",
        ObjectType="Alvenaria",
        ObjectPlacement=wall_a_placement,
        Representation=wall_a_shape,
        Tag="PA-001",
        **({} if is2x3 else {"PredefinedType": "SOLIDWALL"}),
    )
    opening_shape, _ = b.shape([b.box((0.9, 0.4, 2.1), centre_xy=(0.45, 0.0))])
    opening = f.create_entity(
        "IfcOpeningElement",
        GlobalId=b.guid("opening"),
        OwnerHistory=b.history,
        Name="Vão da porta",
        ObjectPlacement=b.placement(wall_a_placement, (1.0, 0.0, 0.0)),
        Representation=opening_shape,
    )
    b.rel(
        "IfcRelVoidsElement",
        "void",
        RelatingBuildingElement=wall_a,
        RelatedOpeningElement=opening,
    )
    # Porta sem representação geométrica: deve aparecer no relatório, sem caixa substituta.
    door = f.create_entity(
        "IfcDoor",
        GlobalId=b.guid("door"),
        OwnerHistory=b.history,
        Name="Porta P1",
        ObjectPlacement=b.placement(wall_a_placement, (1.0, 0.0, 0.0)),
        OverallHeight=b.length(2.1),
        OverallWidth=b.length(0.9),
    )
    b.rel("IfcRelFillsElement", "fill", RelatingOpeningElement=opening, RelatedBuildingElement=door)

    b.assign_pset(
        "wall-a",
        wall_a,
        b.pset(
            "wall-a",
            "Pset_WallCommon",
            [
                b.single("Reference", "IfcIdentifier", "PAR-01"),
                b.single("IsExternal", "IfcBoolean", True),
                b.single("LoadBearing", "IfcBoolean", False),
                b.single("ThermalTransmittance", "IfcThermalTransmittanceMeasure", 2.5),
                b.single("FireRating", "IfcLabel", "EI 120"),
            ],
        ),
    )
    b.assign_pset(
        "wall-a",
        wall_a,
        b.pset(
            "wall-a",
            "Construtora_Dados",
            [
                # Sem unidade própria: vale a unidade de comprimento do arquivo.
                b.single("Altura", "IfcLengthMeasure", b.length(2.8)),
                b.single("Inclinacao", "IfcPlaneAngleMeasure", 90.0 if variant.degrees else 1.5708),
                b.single("Lote", "IfcInteger", 7),
                b.single("Observacao", "IfcText", "Conferir prumo"),
                f.create_entity(
                    "IfcPropertyEnumeratedValue",
                    Name="Fases",
                    EnumerationValues=[
                        f.create_entity("IfcLabel", "Estrutura"),
                        f.create_entity("IfcLabel", "Acabamento"),
                    ],
                ),
                f.create_entity(
                    "IfcPropertyBoundedValue",
                    Name="FaixaDeTemperatura",
                    UpperBoundValue=f.create_entity("IfcReal", 45.0),
                    LowerBoundValue=f.create_entity("IfcReal", 5.0),
                ),
                # Propriedade sem valor: deve aparecer como não informada.
                f.create_entity("IfcPropertySingleValue", Name="Fornecedor"),
            ],
        ),
    )
    quantities = f.create_entity(
        "IfcElementQuantity",
        GlobalId=b.guid("qto:wall-a"),
        OwnerHistory=b.history,
        Name="BaseQuantities" if is2x3 else "Qto_WallBaseQuantities",
        Quantities=[
            f.create_entity("IfcQuantityLength", Name="Length", LengthValue=b.length(4.0)),
            f.create_entity("IfcQuantityLength", Name="Height", LengthValue=b.length(2.8)),
            f.create_entity("IfcQuantityLength", Name="Width", LengthValue=b.length(0.2)),
            f.create_entity("IfcQuantityArea", Name="GrossSideArea", AreaValue=11.2),
            f.create_entity("IfcQuantityVolume", Name="NetVolume", VolumeValue=1.862),
            f.create_entity("IfcQuantityCount", Name="Fiadas", CountValue=14),
        ],
    )
    b.rel(
        "IfcRelDefinesByProperties",
        "qto:wall-a",
        RelatedObjects=[wall_a],
        RelatingPropertyDefinition=quantities,
    )

    layers = [
        f.create_entity(
            "IfcMaterialLayer",
            Material=f.create_entity("IfcMaterial", Name=name),
            LayerThickness=b.length(thickness),
        )
        for name, thickness in (
            ("Argamassa de reboco", 0.02),
            ("Bloco cerâmico", 0.16),
            ("Argamassa de reboco", 0.02),
        )
    ]
    layer_set = f.create_entity(
        "IfcMaterialLayerSet", MaterialLayers=layers, LayerSetName="Alvenaria 20 cm"
    )
    usage = f.create_entity(
        "IfcMaterialLayerSetUsage",
        ForLayerSet=layer_set,
        LayerSetDirection="AXIS2",
        DirectionSense="POSITIVE",
        OffsetFromReferenceLine=b.length(-0.1),
    )
    b.rel(
        "IfcRelAssociatesMaterial",
        "mat:wall-a",
        RelatedObjects=[wall_a],
        RelatingMaterial=usage,
    )

    if is2x3:
        classification = f.create_entity(
            "IfcClassification", Source="ABNT", Edition="2022", Name="NBR 15965"
        )
        class_ref = f.create_entity(
            "IfcClassificationReference",
            ItemReference="3E 04 10",
            Name="Paredes de vedação",
            ReferencedSource=classification,
        )
    else:
        classification = f.create_entity(
            "IfcClassification", Source="ABNT", Edition="2022", Name="NBR 15965"
        )
        class_ref = f.create_entity(
            "IfcClassificationReference",
            Identification="3E 04 10",
            Name="Paredes de vedação",
            ReferencedSource=classification,
        )
    b.rel(
        "IfcRelAssociatesClassification",
        "class:wall-a",
        RelatedObjects=[wall_a],
        RelatingClassification=class_ref,
    )

    # --- parede B: girada 90° em relação ao pavimento ----------------------------------
    wall_b_shape, _ = b.shape([b.box((3.0, 0.2, 2.8), centre_xy=(1.5, 0.0))])
    wall_b = f.create_entity(
        "IfcWall",
        GlobalId=b.guid("wall-b"),
        OwnerHistory=b.history,
        Name="Parede B",
        ObjectPlacement=b.placement(storey0_placement, (4.0, 0.0, 0.0), z=(0, 0, 1), x=(0, 1, 0)),
        Representation=wall_b_shape,
        **({} if is2x3 else {"PredefinedType": "SOLIDWALL"}),
    )
    b.rel(
        "IfcRelDefinesByType",
        "type:walls",
        RelatedObjects=[wall_a, wall_b],
        RelatingType=wall_type,
    )

    # --- laje do pavimento 1 ------------------------------------------------------------
    slab_shape, _ = b.shape([b.box((4.2, 3.2, 0.2), centre_xy=(2.0, 1.5))])
    slab = f.create_entity(
        "IfcSlab",
        GlobalId=b.guid("slab"),
        OwnerHistory=b.history,
        Name="Laje do pavimento 1",
        ObjectPlacement=b.placement(storey1_placement, (0.0, 0.0, -0.2)),
        Representation=slab_shape,
        PredefinedType="FLOOR",
    )
    b.rel(
        "IfcRelAssociatesMaterial",
        "mat:slab",
        RelatedObjects=[slab],
        RelatingMaterial=f.create_entity(
            "IfcMaterialList",
            Materials=[
                f.create_entity("IfcMaterial", Name="Concreto C30"),
                f.create_entity("IfcMaterial", Name="Aço CA-50"),
            ],
        ),
    )

    # --- rampa: referencial inclinado (giro fora do eixo Z) ----------------------------
    tilt = radians(20.0)
    ramp_shape, _ = b.shape([b.box((1.2, 3.0, 0.15), centre_xy=(0.6, 1.5))])
    ramp = f.create_entity(
        "IfcSlab",
        GlobalId=b.guid("ramp"),
        OwnerHistory=b.history,
        Name="Rampa inclinada",
        ObjectPlacement=b.placement(
            storey0_placement, (6.0, 0.0, 0.0), z=(0.0, -sin(tilt), cos(tilt)), x=(1.0, 0.0, 0.0)
        ),
        Representation=ramp_shape,
        PredefinedType="USERDEFINED" if is2x3 else "USERDEFINED",
        ObjectType="Rampa",
    )

    # --- pilares: uma representação compartilhada (IfcMappedItem) ----------------------
    column_solid = b.box((0.3, 0.3, 2.8))
    column_rep = f.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=b.body,
        RepresentationIdentifier="Body",
        RepresentationType="SweptSolid",
        Items=[column_solid],
    )
    column_map = f.create_entity(
        "IfcRepresentationMap", MappingOrigin=b.axis2(), MappedRepresentation=column_rep
    )
    column_type = f.create_entity(
        "IfcColumnType",
        GlobalId=b.guid("columntype"),
        OwnerHistory=b.history,
        Name="Pilar 30x30",
        RepresentationMaps=[column_map],
        PredefinedType="COLUMN",
    )
    concrete = f.create_entity("IfcMaterial", Name="Concreto C30")
    columns = []
    for index, (x, y, turn) in enumerate(((0.5, 2.5, 0.0), (2.0, 2.5, 0.0), (3.5, 2.5, 45.0))):
        operator = f.create_entity(
            "IfcCartesianTransformationOperator3D",
            # Os três eixos são informados: com um só, o web-ifc não deriva os outros dois
            # como o esquema manda e a instância sai distorcida (limitação documentada).
            Axis1=b.direction((cos(radians(turn)), sin(radians(turn)), 0.0)) if turn else None,
            Axis2=b.direction((-sin(radians(turn)), cos(radians(turn)), 0.0)) if turn else None,
            Axis3=b.direction((0.0, 0.0, 1.0)) if turn else None,
            LocalOrigin=b.origin,
            Scale=1.0,
        )
        mapped = f.create_entity("IfcMappedItem", MappingSource=column_map, MappingTarget=operator)
        shape, _ = b.shape([mapped], rep_type="MappedRepresentation")
        column = f.create_entity(
            "IfcColumn",
            GlobalId=b.guid(f"column-{index}"),
            OwnerHistory=b.history,
            Name=f"Pilar P{index + 1}",
            ObjectPlacement=b.placement(storey0_placement, (x, y, 0.0)),
            Representation=shape,
        )
        columns.append(column)
    b.rel("IfcRelDefinesByType", "type:columns", RelatedObjects=columns, RelatingType=column_type)
    b.rel(
        "IfcRelAssociatesMaterial",
        "mat:columns",
        RelatedObjects=[column_type],
        RelatingMaterial=concrete,
    )

    # --- tubo com porta de distribuição -------------------------------------------------
    pipe_profile = f.create_entity(
        "IfcCircleHollowProfileDef",
        ProfileType="AREA",
        # Obrigatório no IFC2X3 (opcional a partir do IFC4): informado em todos.
        Position=f.create_entity(
            "IfcAxis2Placement2D",
            Location=f.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0)),
        ),
        Radius=b.length(0.055),
        WallThickness=b.length(0.005),
    )
    pipe_solid = f.create_entity(
        "IfcExtrudedAreaSolid",
        SweptArea=pipe_profile,
        # Eixo local Z do sólido apontado para +X do elemento: tubo horizontal.
        Position=b.axis2((0.0, 0.0, 0.0), z=(1, 0, 0), x=(0, 1, 0)),
        ExtrudedDirection=b.direction((0.0, 0.0, 1.0)),
        Depth=b.length(3.0),
    )
    pipe_shape, _ = b.shape([pipe_solid])
    pipe_placement = b.placement(storey0_placement, (0.5, 1.5, 2.5))
    pipe = f.create_entity(
        "IfcFlowSegment" if is2x3 else "IfcPipeSegment",
        GlobalId=b.guid("pipe"),
        OwnerHistory=b.history,
        Name="Tubo de água fria",
        ObjectPlacement=pipe_placement,
        Representation=pipe_shape,
        **({} if is2x3 else {"PredefinedType": "RIGIDSEGMENT"}),
    )
    port = f.create_entity(
        "IfcDistributionPort",
        GlobalId=b.guid("port"),
        OwnerHistory=b.history,
        Name="Porta de entrada",
        ObjectPlacement=b.placement(pipe_placement, (0.0, 0.0, 0.0)),
        FlowDirection="SINK",
    )
    if is2x3:
        b.rel("IfcRelConnectsPortToElement", "port", RelatingPort=port, RelatedElement=pipe)
    else:
        b.rel("IfcRelNests", "port", RelatingObject=pipe, RelatedObjects=[port])
        b.rel(
            "IfcRelAssociatesMaterial",
            "mat:pipe",
            RelatedObjects=[pipe],
            RelatingMaterial=f.create_entity(
                "IfcMaterialConstituentSet",
                Name="Tubo de PVC",
                MaterialConstituents=[
                    f.create_entity(
                        "IfcMaterialConstituent",
                        Name="Corpo",
                        Material=f.create_entity("IfcMaterial", Name="PVC rígido"),
                    )
                ],
            ),
        )

    # --- elemento só com eixo (curva): representação que o leitor não triangula --------
    polyline = f.create_entity(
        "IfcPolyline", Points=[b.point((0.0, 0.0, 0.0)), b.point((2.0, 0.0, 0.0))]
    )
    axis_rep = f.create_entity(
        "IfcShapeRepresentation",
        ContextOfItems=b.axis,
        RepresentationIdentifier="Axis",
        RepresentationType="Curve3D",
        Items=[polyline],
    )
    proxy = f.create_entity(
        "IfcBuildingElementProxy",
        GlobalId=b.guid("proxy-axis"),
        OwnerHistory=b.history,
        Name="Eixo de referência",
        ObjectPlacement=b.placement(storey0_placement, (0.0, 4.0, 0.0)),
        Representation=f.create_entity("IfcProductDefinitionShape", Representations=[axis_rep]),
    )

    # --- ambiente --------------------------------------------------------------------
    space_shape, _ = b.shape([b.box((3.6, 2.6, 2.6), centre_xy=(1.9, 1.5))])
    space = f.create_entity(
        "IfcSpace",
        GlobalId=b.guid("space"),
        OwnerHistory=b.history,
        Name="01",
        LongName="Sala",
        ObjectPlacement=b.placement(storey0_placement, (0.0, 0.0, 0.0)),
        Representation=space_shape,
        CompositionType="ELEMENT",
        **({"InteriorOrExteriorSpace": "INTERNAL"} if is2x3 else {"PredefinedType": "SPACE"}),
    )
    b.rel("IfcRelAggregates", "storey0", RelatingObject=storey0, RelatedObjects=[space])

    b.rel(
        "IfcRelContainedInSpatialStructure",
        "contain:storey0",
        RelatingStructure=storey0,
        RelatedElements=[wall_a, wall_b, door, ramp, *columns, pipe, proxy],
    )
    b.rel(
        "IfcRelContainedInSpatialStructure",
        "contain:storey1",
        RelatingStructure=storey1,
        RelatedElements=[slab],
    )
    return f


# --- valores de conferência -----------------------------------------------------------


def mesh_volume(vertices: np.ndarray, faces: np.ndarray) -> float:
    # Em torno do primeiro vértice: com coordenadas de milhares de quilômetros a soma dos
    # tetraedros a partir da origem perde a precisão.
    vertices = vertices - vertices[0]
    a = vertices[faces[:, 0]]
    b = vertices[faces[:, 1]]
    c = vertices[faces[:, 2]]
    return float(abs(np.einsum("ij,ij->i", a, np.cross(b, c)).sum()) / 6.0)


def plain(value):
    if isinstance(value, (list, tuple)):
        return [plain(item) for item in value]
    if isinstance(value, dict):
        return {key: plain(item) for key, item in value.items() if key != "id"}
    if isinstance(value, float):
        return round(value, 9)
    if isinstance(value, ifcopenshell.entity_instance):
        # Valores tipados (ex.: limites de IfcPropertyBoundedValue) vêm como instâncias.
        wrapped = getattr(value, "wrappedValue", None)
        return plain(wrapped) if wrapped is not None else value.is_a()
    return value


def material_names(element) -> list[str]:
    material = ifcopenshell.util.element.get_material(element, should_inherit=True)
    if material is None:
        return []
    if material.is_a("IfcMaterial"):
        return [material.Name]
    if material.is_a("IfcMaterialLayerSetUsage"):
        return [layer.Material.Name for layer in material.ForLayerSet.MaterialLayers]
    if material.is_a("IfcMaterialLayerSet"):
        return [layer.Material.Name for layer in material.MaterialLayers]
    if material.is_a("IfcMaterialList"):
        return [item.Name for item in material.Materials]
    if material.is_a("IfcMaterialConstituentSet"):
        return [item.Material.Name for item in material.MaterialConstituents]
    return [material.is_a()]


def expected_of(path: Path) -> dict:
    model = ifcopenshell.open(str(path))
    settings = ifcopenshell.geom.settings()
    settings.set("use-world-coords", True)
    products = {}
    for product in model.by_type("IfcProduct"):
        entry: dict = {
            "entity": product.is_a(),
            "name": product.Name,
            "bbox": None,
            "volume": None,
        }
        if product.Representation is not None and not product.is_a("IfcOpeningElement"):
            try:
                shape = ifcopenshell.geom.create_shape(settings, product)
                vertices = np.array(shape.geometry.verts, dtype=float).reshape(-1, 3)
                faces = np.array(shape.geometry.faces, dtype=int).reshape(-1, 3)
                if len(faces) > 0:
                    entry["bbox"] = [
                        [round(float(v), 6) for v in vertices.min(axis=0)],
                        [round(float(v), 6) for v in vertices.max(axis=0)],
                    ]
                    entry["volume"] = round(mesh_volume(vertices, faces), 6)
            except RuntimeError:
                pass
        if product.is_a("IfcElement") or product.is_a("IfcSpace"):
            container = ifcopenshell.util.element.get_container(product)
            if container is None and product.is_a("IfcSpace"):
                container = ifcopenshell.util.element.get_aggregate(product)
            element_type = ifcopenshell.util.element.get_type(product)
            entry["container"] = container.Name if container is not None else None
            entry["type"] = element_type.Name if element_type is not None else None
            entry["typeEntity"] = element_type.is_a() if element_type is not None else None
            entry["predefinedType"] = getattr(product, "PredefinedType", None)
            entry["materials"] = material_names(product)
            entry["psets"] = plain(
                ifcopenshell.util.element.get_psets(product, psets_only=True, should_inherit=False)
            )
            entry["typePsets"] = (
                plain(ifcopenshell.util.element.get_psets(element_type, psets_only=True))
                if element_type is not None
                else {}
            )
            entry["quantities"] = plain(
                ifcopenshell.util.element.get_psets(product, qtos_only=True, should_inherit=False)
            )
        products[product.GlobalId] = entry
    return {
        "source": "IfcOpenShell " + ifcopenshell.version,
        "schema": model.schema_identifier,
        "products": products,
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for variant in VARIANTS:
        path = OUT / variant.file_name
        model = build(variant)
        text = model.to_string()
        # O cabeçalho do IfcOpenShell traz a data da gravação; fixá-la mantém o arquivo estável.
        lines = [
            "FILE_NAME('" + variant.file_name + "','2026-01-01T00:00:00',(''),(''),"
            "'IfcOpenShell','IfcOpenShell','');"
            if line.startswith("FILE_NAME(")
            else line
            for line in text.splitlines()
        ]
        path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
        expected = expected_of(path)
        (OUT / (path.stem + ".expected.json")).write_text(
            json.dumps(expected, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        with_geometry = sum(1 for p in expected["products"].values() if p["bbox"])
        print(f"{path.name}: {len(expected['products'])} produtos, {with_geometry} com geometria")


if __name__ == "__main__":
    main()
