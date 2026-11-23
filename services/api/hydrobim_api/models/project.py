"""Espelho de packages/core/src/schema.ts (fonte única de verdade).

Objetos ignoram campos extras, como z.object(); números não aceitam strings,
booleanos, NaN ou infinito. Timestamps são strings livres, conforme o schema.
"""

from math import isfinite
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    SerializerFunctionWrapHandler,
    model_serializer,
    model_validator,
)
from pydantic.alias_generators import to_camel

PROJECT_FORMAT = "hydrobim-project"
SCHEMA_VERSION = 20


def _json_number(value: Any) -> int | float:
    """Zod aceita números JSON, sem converter strings ou booleanos."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("O valor deve ser um número.")
    return value


FiniteNumber = Annotated[float, Field(allow_inf_nan=False)]
PositiveNumber = Annotated[FiniteNumber, Field(gt=0)]
NonNegativeNumber = Annotated[FiniteNumber, Field(ge=0)]
NonEmptyString = Annotated[str, Field(min_length=1)]
# JSON/JavaScript não distingue 1 de 1.0; strict=False só após conferir o tipo.
NonNegativeInteger = Annotated[int, Field(ge=0, strict=False), BeforeValidator(_json_number)]
PositiveInteger = Annotated[int, Field(gt=0, strict=False), BeforeValidator(_json_number)]
Material = Literal["pvc", "hdpe", "ductileIron", "carbonSteel"]
JointType = Literal["solventWeld", "socketSpigot", "buttFusion", "buttWeld", "flanged", "threaded"]
ValveType = Literal[
    "gate",
    "globe",
    "ball",
    "butterfly",
    "check",
    "airRelease",
    "pressureReducing",
    "strainer",
    "flowMeter",
]
EndType = Literal["plain", "socket", "flange"]
SystemKind = Literal[
    "domesticColdWater", "domesticHotWater", "fireProtection", "waterSupply", "other"
]
Discipline = Literal["mep", "infra", "architecture"]
DimensionMode = Literal["aligned", "horizontal", "vertical"]
TankType = Literal[
    "generic",
    "gobletWet",
    "gobletDry",
    "tubular",
    "australian",
    "verticalGround",
    "verticalConeLegs",
    "fieldErected",
    "horizontal",
]
TankNozzleRole = Literal["inlet", "outlet", "overflow", "drain"]
TankSupportType = Literal["legs", "skid"]
PropertyValue = str | FiniteNumber | bool


class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        serialize_by_alias=True,
        strict=True,
        allow_inf_nan=False,
        extra="ignore",
    )

    @model_serializer(mode="wrap", when_used="unless-none")
    def serialize_optional_fields(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        """Omite somente defaults ausentes; preserva null dos campos nullable obrigatórios."""
        result = handler(self)
        for name, field in type(self).model_fields.items():
            if not field.is_required() and field.default is None and getattr(self, name) is None:
                result.pop(name, None)
                result.pop(field.alias, None)
        return result


class Vec3(CamelModel):
    x: FiniteNumber
    y: FiniteNumber
    z: FiniteNumber


class Quat(CamelModel):
    x: FiniteNumber
    y: FiniteNumber
    z: FiniteNumber
    w: FiniteNumber


class PipeSpec(CamelModel):
    specification_id: NonEmptyString
    material: Material
    standard: str
    joint_type: JointType
    pressure_class: str | None
    dn: PositiveNumber
    size_label: str
    outer_diameter: PositiveNumber
    inner_diameter: PositiveNumber
    wall_thickness: PositiveNumber
    # Deflexão angular admitida em cada junta (rad), do catálogo; ausente = junta rígida.
    joint_deflection: PositiveNumber = Field(default=None, validate_default=False)
    # Curvatura a frio do tubo: raio da poligonal equivalente (m) e barra considerada (m).
    cold_bend_radius: PositiveNumber = Field(default=None, validate_default=False)
    cold_bend_span: PositiveNumber = Field(default=None, validate_default=False)


class ElementMeta(CamelModel):
    created_at: str
    updated_at: str
    revision: NonNegativeInteger


class Manufacturing(CamelModel):
    # z.string().optional(): ausência permitida, null explícito rejeitado.
    # None é apenas o default interno não validado de um campo ausente.
    manufacturer: str = Field(default=None, validate_default=False)
    model: str = Field(default=None, validate_default=False)
    part_number: str = Field(default=None, validate_default=False)

    @model_serializer(mode="wrap")
    def serialize_optional_fields(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        return {key: value for key, value in handler(self).items() if value is not None}


class Placement(CamelModel):
    position: Vec3
    rotation: Quat


class EndTreatment(CamelModel):
    type: EndType
    length: NonNegativeNumber
    outer_diameter: PositiveNumber
    # Furação do flange (círculo, número e diâmetro dos furos), quando tabulada.
    bolt_circle: PositiveNumber = Field(default=None, validate_default=False)
    bolt_count: PositiveInteger = Field(default=None, validate_default=False)
    bolt_hole_diameter: PositiveNumber = Field(default=None, validate_default=False)
    # Ressalto da face de vedação (diâmetro e altura, já incluída em length), quando tabulado.
    raised_face_diameter: PositiveNumber = Field(default=None, validate_default=False)
    raised_face_height: PositiveNumber = Field(default=None, validate_default=False)


class ElementBase(CamelModel):
    id: NonEmptyString
    name: str
    system_id: NonEmptyString
    spec: PipeSpec
    family_id: str | None
    properties: dict[str, PropertyValue]
    manufacturing: Manufacturing
    # Esquema v9: valores IFC informados pelo usuário para a ocorrência, por
    # "Conjunto.Propriedade" (opcional).
    ifc: dict[str, PropertyValue] = Field(default=None, validate_default=False)
    meta: ElementMeta


class Pipe(ElementBase):
    kind: Literal["pipe"]
    start: Vec3
    end: Vec3
    # Esquema v7: acabamento das extremidades `start`/`end` (tubos com flanges), opcional.
    ends: dict[str, EndTreatment] = Field(default=None, validate_default=False)


class FittingBase(ElementBase):
    placement: Placement
    ends: dict[str, EndTreatment]


class ElbowStraight(CamelModel):
    a: NonNegativeNumber
    b: NonNegativeNumber


class Elbow(FittingBase):
    kind: Literal["elbow"]
    angle: PositiveNumber
    bend_radius: PositiveNumber
    # Esquema v10: trechos retos entre o arco e as portas (curvas ponta e bolsa).
    straight: ElbowStraight = Field(default=None, validate_default=False)


class Tee(FittingBase):
    kind: Literal["tee"]
    run_length: PositiveNumber
    branch_length: PositiveNumber
    branch_spec: PipeSpec = Field(default=None, validate_default=False)


class Cross(FittingBase):
    """Esquema v14: cruzeta — passagem `a`/`b` e derivações opostas `branch` e `branch2`."""

    kind: Literal["cross"]
    run_length: PositiveNumber
    branch_length: PositiveNumber
    branch_spec: PipeSpec = Field(default=None, validate_default=False)


class Reducer(FittingBase):
    kind: Literal["reducer"]
    outlet_spec: PipeSpec
    length: PositiveNumber


class Valve(FittingBase):
    kind: Literal["valve"]
    valve_type: ValveType
    length: PositiveNumber
    height: PositiveNumber = Field(default=None, validate_default=False)
    handwheel_diameter: PositiveNumber = Field(default=None, validate_default=False)
    width: PositiveNumber = Field(default=None, validate_default=False)
    bonnet_length: PositiveNumber = Field(default=None, validate_default=False)


class Pump(FittingBase):
    kind: Literal["pump"]
    discharge_spec: PipeSpec
    length: PositiveNumber
    # Esquema v13: só a bomba genérica usa a posição do recalque (opcionais).
    discharge_offset: PositiveNumber = Field(default=None, validate_default=False)
    discharge_height: PositiveNumber = Field(default=None, validate_default=False)
    rated_flow: PositiveNumber = Field(default=None, validate_default=False)
    rated_head: PositiveNumber = Field(default=None, validate_default=False)
    # Esquema v13: bomba de catálogo (anfíbia em linha) — forma construtiva, linha da tabela,
    # estágios, classes dos flanges e cotas do dimensional do fabricante (C, D, E, G, ØH, I, J).
    pump_type: Literal["generic", "amphibious"] = Field(default=None, validate_default=False)
    variant_id: NonEmptyString = Field(default=None, validate_default=False)
    stages: PositiveInteger = Field(default=None, validate_default=False)
    suction_flange_class: NonEmptyString = Field(default=None, validate_default=False)
    discharge_flange_class: NonEmptyString = Field(default=None, validate_default=False)
    foot_offset: PositiveNumber = Field(default=None, validate_default=False)
    foot_span: PositiveNumber = Field(default=None, validate_default=False)
    rear_length: PositiveNumber = Field(default=None, validate_default=False)
    foot_width: PositiveNumber = Field(default=None, validate_default=False)
    foot_hole_diameter: PositiveNumber = Field(default=None, validate_default=False)
    axis_height: PositiveNumber = Field(default=None, validate_default=False)
    total_height: PositiveNumber = Field(default=None, validate_default=False)


class TankNozzle(CamelModel):
    """Bocal adicional do reservatório; o id é o identificador da porta."""

    id: NonEmptyString
    role: TankNozzleRole
    height: NonNegativeNumber
    azimuth: FiniteNumber
    spec: PipeSpec


class TankAccessories(CamelModel):
    ladder: bool
    ladder_azimuth: FiniteNumber
    cage: bool
    guardrail: bool
    guardrail_height: PositiveNumber
    manhole: bool


class Tank(FittingBase):
    kind: Literal["tank"]
    diameter: PositiveNumber
    height: PositiveNumber
    outlet_height: NonNegativeNumber
    inlet_height: NonNegativeNumber
    nozzle_length: PositiveNumber
    # Esquema v6: forma construtiva, modelo comercial, bocais e acessórios (opcionais).
    tank_type: TankType = Field(default=None, validate_default=False)
    variant_id: NonEmptyString = Field(default=None, validate_default=False)
    nominal_capacity: PositiveNumber = Field(default=None, validate_default=False)
    column_height: PositiveNumber = Field(default=None, validate_default=False)
    column_diameter: PositiveNumber = Field(default=None, validate_default=False)
    cone_height: PositiveNumber = Field(default=None, validate_default=False)
    support_height: NonNegativeNumber = Field(default=None, validate_default=False)
    support_type: TankSupportType = Field(default=None, validate_default=False)
    length: PositiveNumber = Field(default=None, validate_default=False)
    shell_thickness: PositiveNumber = Field(default=None, validate_default=False)
    compartments: PositiveInteger = Field(default=None, validate_default=False)
    max_water_level: PositiveNumber = Field(default=None, validate_default=False)
    accessories: TankAccessories = Field(default=None, validate_default=False)
    nozzles: list[TankNozzle] = Field(default=None, validate_default=False)


class TankVariant(CamelModel):
    """Linha da tabela de uma família de reservatórios (SI; capacidade em litros)."""

    id: NonEmptyString
    capacity_l: PositiveNumber
    height: PositiveNumber
    diameter: PositiveNumber
    column_height: PositiveNumber = Field(default=None, validate_default=False)
    mark: str = Field(default=None, validate_default=False)


class TankCustomDefaults(CamelModel):
    capacity_l: PositiveNumber
    diameter: PositiveNumber
    height: PositiveNumber
    length: PositiveNumber = Field(default=None, validate_default=False)


class TankFamily(CamelModel):
    """Família de reservatórios personalizada no projeto (espelho de TankFamilySchema)."""

    id: NonEmptyString
    name: NonEmptyString
    tank_type: Literal[
        "gobletWet",
        "gobletDry",
        "tubular",
        "australian",
        "verticalGround",
        "verticalConeLegs",
        "fieldErected",
        "horizontal",
    ]
    manufacturer: str
    material: str
    source: str
    page: NonNegativeInteger
    description: str
    variants: list[TankVariant]
    capacity_range_l: Annotated[list[PositiveNumber], Field(min_length=2, max_length=2)]
    catalog_heights: list[PositiveNumber] = Field(default=None, validate_default=False)
    catalog_support_height: PositiveNumber = Field(default=None, validate_default=False)
    custom_defaults: TankCustomDefaults
    approximations: list[str]
    remarks: list[str]
    origin: Literal["builtin", "custom"]
    based_on: str = Field(default=None, validate_default=False)


class PumpFlangeRef(CamelModel):
    dn: PositiveNumber
    pressure_class: NonEmptyString


class PumpDimensions(CamelModel):
    """Cotas do dimensional (m): C, D, E, F, G, ØH, I e J."""

    foot_offset: PositiveNumber
    foot_span: PositiveNumber
    rear_length: PositiveNumber
    length: PositiveNumber
    foot_width: PositiveNumber
    foot_hole_diameter: PositiveNumber
    axis_height: PositiveNumber
    total_height: PositiveNumber


class PumpVariant(CamelModel):
    id: NonEmptyString
    models: Annotated[list[NonEmptyString], Field(min_length=1)]
    frame: str
    suction: PumpFlangeRef
    discharge: PumpFlangeRef
    dimensions: PumpDimensions
    weight_kg: PositiveNumber = Field(default=None, validate_default=False)
    stages: PositiveInteger


class PumpFamily(CamelModel):
    """Família de bombas personalizada no projeto (espelho de PumpFamilySchema)."""

    id: NonEmptyString
    name: NonEmptyString
    pump_type: Literal["amphibious"]
    manufacturer: str
    frequency_hz: PositiveNumber
    source: str
    page: NonNegativeInteger
    description: str
    variants: list[PumpVariant]
    approximations: list[str]
    remarks: list[str]
    origin: Literal["builtin", "custom"]
    based_on: str = Field(default=None, validate_default=False)


HydroElement = Annotated[
    Pipe | Elbow | Tee | Cross | Reducer | Valve | Pump | Tank, Field(discriminator="kind")
]


class PortRef(CamelModel):
    element_id: NonEmptyString
    port_id: NonEmptyString


class Connection(CamelModel):
    id: NonEmptyString
    a: PortRef
    b: PortRef


class HydraulicSystem(CamelModel):
    id: NonEmptyString
    name: str
    kind: SystemKind
    color: Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")] = Field(
        default=None, validate_default=False
    )
    visible: bool = Field(default=None, validate_default=False)


class FamilyEnd(CamelModel):
    length: NonNegativeNumber
    outer_diameter: PositiveNumber
    # Furação do flange (círculo, número e diâmetro dos furos), quando tabulada.
    bolt_circle: PositiveNumber = Field(default=None, validate_default=False)
    bolt_count: PositiveInteger = Field(default=None, validate_default=False)
    bolt_hole_diameter: PositiveNumber = Field(default=None, validate_default=False)
    # Ressalto da face de vedação (diâmetro e altura, já incluída em length), quando tabulado.
    raised_face_diameter: PositiveNumber = Field(default=None, validate_default=False)
    raised_face_height: PositiveNumber = Field(default=None, validate_default=False)


class FamilySize(CamelModel):
    dn: PositiveNumber
    dn2: PositiveNumber = Field(default=None, validate_default=False)
    center_to_end: PositiveNumber = Field(default=None, validate_default=False)
    center_to_end2: PositiveNumber = Field(default=None, validate_default=False)
    bend_radius: PositiveNumber = Field(default=None, validate_default=False)
    center_to_branch: PositiveNumber = Field(default=None, validate_default=False)
    length: PositiveNumber = Field(default=None, validate_default=False)
    height: PositiveNumber = Field(default=None, validate_default=False)
    handwheel_diameter: PositiveNumber = Field(default=None, validate_default=False)
    width: PositiveNumber = Field(default=None, validate_default=False)
    bonnet_length: PositiveNumber = Field(default=None, validate_default=False)
    end: FamilyEnd = Field(default=None, validate_default=False)
    end2: FamilyEnd = Field(default=None, validate_default=False)


class FittingFamily(CamelModel):
    id: NonEmptyString
    name: str
    kind: Literal["elbow", "tee", "cross", "reducer", "valve"]
    specification_id: NonEmptyString
    end_type: EndType
    angle: PositiveNumber = Field(default=None, validate_default=False)
    valve_type: ValveType = Field(default=None, validate_default=False)
    manufacturer: str | None
    standard: str
    source: str
    origin: Literal["builtin", "custom"]
    sizes: list[FamilySize]


class Level(CamelModel):
    id: NonEmptyString
    name: str
    elevation: FiniteNumber


class Georeference(CamelModel):
    crs_name: NonEmptyString
    epsg: Annotated[int, Field(gt=0, strict=False), BeforeValidator(_json_number)] | None
    eastings: FiniteNumber
    northings: FiniteNumber
    orthogonal_height: FiniteNumber
    rotation: FiniteNumber
    # Esquema v11: referência altimétrica das cotas; None = não informada.
    vertical_datum: NonEmptyString | None


class InfraBasemap(CamelModel):
    # None = fundo técnico limpo; o domínio guarda só a escolha da fonte de mapa.
    source_id: NonEmptyString | None
    visible: bool
    opacity: Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]


class InfraLayers(CamelModel):
    network: bool
    equipment: bool
    terrain: bool
    references: bool
    annotations: bool


class InfraLabels(CamelModel):
    names: bool
    lengths: bool
    elevations: bool


class InfraSettings(CamelModel):
    """Configuração da Planta Infra (esquema v11), independente da planta do MEP."""

    drawing_scale: PositiveNumber
    basemap: InfraBasemap
    layers: InfraLayers
    labels: InfraLabels


def default_infra_settings(drawing_scale: float = 1000) -> dict[str, Any]:
    """Mesmo padrão de `defaultInfraSettings` (core/schema.ts)."""
    return {
        "drawingScale": drawing_scale,
        "basemap": {"sourceId": None, "visible": True, "opacity": 1},
        "layers": {
            "network": True,
            "equipment": True,
            "terrain": True,
            "references": True,
            "annotations": True,
        },
        "labels": {"names": False, "lengths": False, "elevations": False},
    }


class TerrainSource(CamelModel):
    """Procedência dos dados de elevação (esquema v12). O que a fonte não declara fica nulo."""

    kind: Literal["survey", "dem"]
    provider: NonEmptyString
    dataset: NonEmptyString | None
    horizontal_crs: NonEmptyString | None
    vertical_datum: NonEmptyString | None
    resolution: PositiveNumber | None
    vertical_accuracy: PositiveNumber | None
    acquired_at: NonEmptyString | None
    attribution: NonEmptyString | None
    notes: NonEmptyString | None


def survey_source() -> dict[str, Any]:
    """Procedência de um terreno antigo: levantamento por pontos, sem nada presumido."""
    return {
        "kind": "survey",
        "provider": "Pontos XYZ",
        "dataset": None,
        "horizontalCrs": None,
        "verticalDatum": None,
        "resolution": None,
        "verticalAccuracy": None,
        "acquiredAt": None,
        "attribution": None,
        "notes": None,
    }


class TerrainMesh(CamelModel):
    """Malha de uma superfície: pontos, faces, limite e linhas de quebra."""

    points: list[Vec3]
    triangles: list[NonNegativeInteger]
    # Esquema v12: limite (contorno e furos) e linhas de quebra.
    boundary: (
        Annotated[list[Annotated[list[Vec3], Field(min_length=3)]], Field(min_length=1)] | None
    )
    breaklines: list[Annotated[list[Vec3], Field(min_length=2)]]


class Terrain(TerrainMesh):
    # Esquema v17: identificador persistente, identificação dada pelo projetista e a malha
    # original (guardada na primeira edição; nula enquanto a superfície não é editada).
    id: NonEmptyString
    name: str
    tag: str
    source: TerrainSource
    original: TerrainMesh | None


class Point2(CamelModel):
    """Ponto da planta (plano XY), em metros."""

    x: FiniteNumber
    y: FiniteNumber


class Platform(CamelModel):
    """Platô (esquema v17): perímetro, cota de implantação e taludes H:V."""

    id: NonEmptyString
    name: str
    outline: Annotated[list[Point2], Field(min_length=3)]
    elevation: FiniteNumber
    cut_slope: PositiveNumber
    fill_slope: PositiveNumber


class Earthworks(CamelModel):
    """Terraplenagem (esquema v17). Parâmetro de volume não informado fica nulo."""

    platforms: list[Platform]
    swell_percent: Annotated[FiniteNumber, Field(ge=0, le=200)] | None
    # m³ de aterro compactado obtidos de 1 m³ de corte in situ.
    compaction_factor: Annotated[FiniteNumber, Field(gt=0, le=2)] | None
    reuse_percent: Annotated[FiniteNumber, Field(ge=0, le=100)] | None


def default_earthworks() -> dict[str, Any]:
    return {
        "platforms": [],
        "swellPercent": None,
        "compactionFactor": None,
        "reusePercent": None,
    }


class DimensionAnnotation(CamelModel):
    id: NonEmptyString
    kind: Literal["dimension"]
    a: Point2
    b: Point2
    offset: FiniteNumber
    mode: DimensionMode


class TextAnnotation(CamelModel):
    id: NonEmptyString
    kind: Literal["text"]
    position: Point2
    text: NonEmptyString
    rotation: FiniteNumber
    leader: Point2 = Field(default=None, validate_default=False)


class TagAnnotation(CamelModel):
    id: NonEmptyString
    kind: Literal["tag"]
    element_id: NonEmptyString
    position: Point2


Annotation = Annotated[
    DimensionAnnotation | TextAnnotation | TagAnnotation, Field(discriminator="kind")
]


# Esquema v15: vistas de projeto e detalhes 2D (espelha packages/core/src/schema.ts).
class DetailLine(CamelModel):
    id: NonEmptyString
    kind: Literal["line"]
    a: Point2
    b: Point2


class DetailPolyline(CamelModel):
    id: NonEmptyString
    kind: Literal["polyline"]
    points: Annotated[list[Point2], Field(min_length=2)]
    closed: bool


class DetailRect(CamelModel):
    id: NonEmptyString
    kind: Literal["rect"]
    a: Point2
    b: Point2


class DetailCircle(CamelModel):
    id: NonEmptyString
    kind: Literal["circle"]
    center: Point2
    radius: PositiveNumber


ViewDetail = Annotated[
    DetailLine | DetailPolyline | DetailRect | DetailCircle | TextAnnotation | DimensionAnnotation,
    Field(discriminator="kind"),
]
# Esquema v16: as categorias de arquitetura também podem ser ocultadas na vista.
ViewCategory = Literal[
    "pipes",
    "fittings",
    "valves",
    "equipment",
    "tanks",
    "walls",
    "floors",
    "doors",
    "windows",
    "spaces",
    # Esquema v18.
    "roofs",
    # Esquema v19: objetos de modelos IFC importados.
    "ifcModels",
]


class ViewVisibility(CamelModel):
    hidden_system_ids: list[NonEmptyString]
    hidden_categories: list[ViewCategory]
    details: bool


class ViewStyle(CamelModel):
    theme: Literal["color", "mono"]
    thin_lines: bool


class ViewCrop(CamelModel):
    enabled: bool
    min: Point2
    max: Point2


class ViewFrame(CamelModel):
    center: Point2
    height: PositiveNumber


class ViewBase(CamelModel):
    id: NonEmptyString
    name: NonEmptyString
    visibility: ViewVisibility


class View2dBase(ViewBase):
    scale: PositiveNumber
    style: ViewStyle
    crop: ViewCrop | None
    frame: ViewFrame | None
    details: list[ViewDetail]


class PlanView(View2dBase):
    kind: Literal["plan"]
    level_id: NonEmptyString
    cut_height: FiniteNumber
    depth: PositiveNumber
    # Esquema v16: altura, acima do nível, do plano em que a arquitetura é cortada.
    arch_cut_height: PositiveNumber
    rotation: FiniteNumber


class SectionView(View2dBase):
    kind: Literal["section"]
    a: Point2
    b: Point2
    side: Annotated[Literal[1, -1], BeforeValidator(_json_number)]
    depth: PositiveNumber


class ElevationView(View2dBase):
    kind: Literal["elevation"]
    direction: Literal["north", "south", "east", "west"]


class ViewCamera(CamelModel):
    target: Vec3
    direction: Vec3
    half_height: PositiveNumber
    projection: Literal["perspective", "orthographic"]


class SectionBox(CamelModel):
    enabled: bool
    min: Vec3
    max: Vec3


class ModelView(ViewBase):
    kind: Literal["3d"]
    camera: ViewCamera | None
    section_box: SectionBox | None
    display: Literal["shaded", "wireframe"]


ProjectView = Annotated[
    PlanView | SectionView | ElevationView | ModelView, Field(discriminator="kind")
]


# Esquema v16: arquitetura — tipos, ocorrências e ambientes (espelha core/schema.ts).
# Os elementos arquitetônicos ficam em `Project.architecture`, fora de `Project.elements`:
# não têm sistema hidráulico, especificação de tubo nem portas.
ArchLayerFunction = Literal["structure", "substrate", "finish", "insulation", "membrane", "other"]
ArchHatch = Literal["none", "solid", "diagonal", "crossed", "dotted"]


class ArchLayer(CamelModel):
    """Camada de material de um tipo (parede, laje ou revestimento), na ordem de montagem."""

    id: NonEmptyString
    material: NonEmptyString
    thickness: PositiveNumber
    function: ArchLayerFunction
    hatch: ArchHatch


class ArchClassification(CamelModel):
    """Classificação externa do tipo; o código é sempre informado pelo usuário."""

    system: Literal["nbr15965", "sinapi", "other"]
    table: NonEmptyString = Field(default=None, validate_default=False)
    code: NonEmptyString
    description: NonEmptyString = Field(default=None, validate_default=False)


class ArchTypeBase(CamelModel):
    id: NonEmptyString
    name: NonEmptyString
    # None = tipo criado sem família do catálogo.
    family_id: NonEmptyString | None
    # False = produto de fabricante: a fonte é obrigatória (ver services/validation.py).
    generic: bool
    source: NonEmptyString | None
    manufacturing: Manufacturing
    classifications: list[ArchClassification]
    ifc_predefined_type: NonEmptyString
    ifc: dict[str, PropertyValue]


class LayeredArchType(ArchTypeBase):
    # A espessura do tipo é a soma das camadas.
    layers: Annotated[list[ArchLayer], Field(min_length=1)]


class WallType(LayeredArchType):
    category: Literal["wall"]


class SlabType(LayeredArchType):
    category: Literal["slab"]


class FlooringType(LayeredArchType):
    category: Literal["flooring"]


class RoofType(LayeredArchType):
    """Telhado (esquema v18): tipologia e camadas, de cima para baixo.

    A espessura (soma das camadas) é medida perpendicularmente à água.
    """

    category: Literal["roof"]
    shape: Literal["shed", "gable"]


class JoineryMaterials(CamelModel):
    """Materiais dos componentes da esquadria, quando informados (sem valor = pendente)."""

    frame: NonEmptyString = Field(default=None, validate_default=False)
    panel: NonEmptyString = Field(default=None, validate_default=False)
    glazing: NonEmptyString = Field(default=None, validate_default=False)


class DoorFrieze(CamelModel):
    """Friso reto da folha, de borda a borda; `position` é fração da folha (0 a 1, exclusivos).

    Horizontal: da base para o topo. Vertical: da borda das dobradiças para a da fechadura.
    """

    orientation: Literal["horizontal", "vertical"]
    position: Annotated[float, Field(gt=0, lt=1)]


class DoorLeafDesign(CamelModel):
    """Desenho da folha (esquema v20). `schematic` = posição dos frisos não cotada pela fonte."""

    friezes: Annotated[list[DoorFrieze], Field(min_length=1)]
    frieze_width: PositiveNumber
    schematic: bool


class DoorType(ArchTypeBase):
    category: Literal["door"]
    operation: Literal["singleSwing", "doubleSwing", "sliding", "pivot"]
    width: PositiveNumber
    height: PositiveNumber
    frame_width: PositiveNumber
    panel_thickness: PositiveNumber
    materials: JoineryMaterials
    # Esquema v20: ausente = folha lisa.
    leaf: DoorLeafDesign = Field(default=None, validate_default=False)


class WindowType(ArchTypeBase):
    category: Literal["window"]
    operation: Literal["fixed", "sliding", "casement", "pivotHorizontal", "topHung"]
    width: PositiveNumber
    height: PositiveNumber
    sill_height: NonNegativeNumber
    panels: PositiveInteger
    frame_width: PositiveNumber
    materials: JoineryMaterials


ArchType = Annotated[
    WallType | SlabType | FlooringType | RoofType | DoorType | WindowType,
    Field(discriminator="category"),
]


class ArchElementBase(CamelModel):
    id: NonEmptyString
    name: str
    properties: dict[str, PropertyValue]
    # Valores IFC informados pelo usuário para a ocorrência (sobrepõem os do tipo); opcional.
    ifc: dict[str, PropertyValue] = Field(default=None, validate_default=False)
    meta: ElementMeta


class Wall(ArchElementBase):
    kind: Literal["wall"]
    type_id: NonEmptyString
    level_id: NonEmptyString
    start: Point2
    end: Point2
    location_line: Literal["center", "faceLeft", "faceRight"]
    base_offset: FiniteNumber
    height: PositiveNumber


class FloorOpening(CamelModel):
    """Abertura em laje ou revestimento: contorno fechado, sem repetir o primeiro ponto."""

    id: NonEmptyString
    boundary: Annotated[list[Point2], Field(min_length=3)]


class FloorBase(ArchElementBase):
    type_id: NonEmptyString
    level_id: NonEmptyString
    boundary: Annotated[list[Point2], Field(min_length=3)]
    openings: list[FloorOpening]
    # Laje: cota do topo em relação ao nível; revestimento: cota da base.
    offset: FiniteNumber


class Slab(FloorBase):
    kind: Literal["slab"]


class Flooring(FloorBase):
    kind: Literal["flooring"]


class Roof(ArchElementBase):
    """Telhado de uma ou duas águas sobre contorno retangular (esquema v18).

    A cota de referência (nível + `offset`) é a da face inferior sobre a linha do beiral do
    contorno; `eave_edge` é o lado do contorno que é beiral; `overhang` é medido na horizontal.
    """

    kind: Literal["roof"]
    type_id: NonEmptyString
    level_id: NonEmptyString
    boundary: Annotated[list[Point2], Field(min_length=4, max_length=4)]
    eave_edge: Annotated[int, Field(ge=0, le=3, strict=False), BeforeValidator(_json_number)]
    offset: FiniteNumber
    slope: PositiveNumber
    overhang: NonNegativeNumber


class HostedBase(ArchElementBase):
    type_id: NonEmptyString
    # Parede hospedeira: o vão não existe sem ela.
    host_id: NonEmptyString
    offset: FiniteNumber
    sill_height: NonNegativeNumber
    hand: Literal["left", "right"]
    facing: Annotated[Literal[1, -1], BeforeValidator(_json_number)]


class Door(HostedBase):
    kind: Literal["door"]


class Window(HostedBase):
    kind: Literal["window"]


class Space(ArchElementBase):
    """Ambiente: região do pavimento; o pé-direito fica nulo enquanto não for informado."""

    kind: Literal["space"]
    level_id: NonEmptyString
    number: NonEmptyString = Field(default=None, validate_default=False)
    boundary: Annotated[list[Point2], Field(min_length=3)]
    offset: FiniteNumber
    height: PositiveNumber | None


ArchElement = Annotated[
    Wall | Slab | Flooring | Roof | Door | Window | Space, Field(discriminator="kind")
]


class Architecture(CamelModel):
    types: list[ArchType]
    elements: list[ArchElement]


def default_arch_cut_height(cut_height: Any) -> float:
    """Mesmo padrão de `defaultArchCutHeight` (core/schema.ts): 1,20 m, limitado à planta."""
    is_number = isinstance(cut_height, int | float) and not isinstance(cut_height, bool)
    top = cut_height if is_number and isfinite(cut_height) else 1.2
    return max(0.1, min(1.2, top))


# --- Modelos IFC importados (esquema v19) -----------------------------------------------
# Objetos de referência lidos de arquivos .ifc: o projeto guarda o arquivo-fonte íntegro
# (compactado), os objetos incluídos e as transformações. Malhas e propriedades são relidas
# da fonte pelo editor; o backend só valida o contrato.

IFC_IMPORT_MAX_OBJECTS = 50_000


class IfcSource(CamelModel):
    file_name: NonEmptyString
    byte_length: Annotated[int, Field(ge=0)]
    sha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    encoding: Literal["gzip-base64"]
    # Vazio = fonte não embutida (cópia de trabalho do navegador).
    data: str


class IfcTransform(CamelModel):
    translation: Vec3
    # Giro em torno de Z, em radianos.
    rotation: FiniteNumber


class IfcImportedObject(CamelModel):
    id: NonEmptyString
    express_id: Annotated[int, Field(gt=0)]
    global_id: str
    transform: IfcTransform | None
    copy_: Annotated[bool, Field(alias="copy")]


class IfcImportedModel(CamelModel):
    id: NonEmptyString
    name: NonEmptyString
    source: IfcSource
    schema_: Annotated[NonEmptyString, Field(alias="schema")]
    length_unit: str
    unit_scale: PositiveNumber
    imported_at: str
    placement_mode: Literal["original", "basePoint", "offset", "aligned"]
    placement: IfcTransform
    visible: bool
    opacity: Annotated[FiniteNumber, Field(ge=0.05, le=1)]
    objects: Annotated[list[IfcImportedObject], Field(max_length=IFC_IMPORT_MAX_OBJECTS)]


class Units(CamelModel):
    length: Literal["m"]
    angle: Literal["rad"]


class Project(CamelModel):
    format: Literal["hydrobim-project"]
    schema_version: Annotated[Literal[20], BeforeValidator(_json_number)]
    id: NonEmptyString
    name: str
    discipline: Discipline
    units: Units
    created_at: str
    updated_at: str
    systems: Annotated[list[HydraulicSystem], Field(min_length=1)]
    levels: list[Level]
    families: list[FittingFamily]
    tank_families: list[TankFamily]
    # Esquema v13: famílias de bombas personalizadas no projeto.
    pump_families: list[PumpFamily]
    # Esquema v9: valores IFC do usuário por tipo: {chave: {"Conjunto.Propriedade": valor}}.
    ifc_types: dict[str, dict[str, PropertyValue]]
    georeference: Georeference | None
    terrain: Terrain | None
    # Esquema v17: platôs e parâmetros de volume (o terreno projetado é derivado).
    earthworks: Earthworks
    elements: list[HydroElement]
    connections: list[Connection]
    annotations: list[Annotation]
    drawing_scale: PositiveNumber
    infra: InfraSettings
    # Esquema v15: vistas de projeto, na ordem do navegador.
    views: list[ProjectView]
    # Esquema v16: modelo arquitetônico, nos mesmos níveis e coordenadas da rede.
    architecture: Architecture
    # Esquema v19: modelos IFC importados como referência.
    ifc_models: list[IfcImportedModel]

    @model_validator(mode="before")
    @classmethod
    def migrate(cls, document: Any) -> Any:
        """Mesmas migrações de core/serialization.ts (v1 → … → v20), sem mutar o documento."""
        if not isinstance(document, dict):
            return document
        version = document.get("schemaVersion", document.get("schema_version"))
        if isinstance(version, bool) or version not in tuple(range(1, 20)):
            return document
        if version == 19:
            # v19 → v20: desenho da folha no tipo de porta (`leaf`), opcional. Documentos v19
            # já são válidos: nada muda além da versão.
            return {**document, "schemaVersion": 20}
        if version != 18:
            document = cls._migrate_to_v18(document)
        # v18 → v19: modelos IFC importados (nenhum nos documentos antigos) e a categoria
        # `ifcModels` nas vistas.
        return {"ifcModels": [], **document, "schemaVersion": 20}

    @classmethod
    def _migrate_to_v18(cls, document: dict[str, Any]) -> dict[str, Any]:
        """Migrações v1 → … → v18."""
        version = document.get("schemaVersion", document.get("schema_version"))
        if isinstance(version, bool) or version not in tuple(range(1, 18)):
            return document
        if version == 17:
            # v17 → v18: telhados na arquitetura e a categoria `roofs` nas vistas. Só
            # acrescenta possibilidades: nada muda além da versão.
            return {**document, "schemaVersion": 18}
        if version != 16:
            document = cls._migrate_before_v16(document)
        # v16 → v17: superfície do terreno como elemento (identificador fixo nas superfícies
        # antigas, identificação vazia, nunca editada) e terraplenagem sem platôs nem
        # parâmetros de volume presumidos.
        terrain = document.get("terrain")
        return {
            "earthworks": default_earthworks(),
            **document,
            "schemaVersion": 18,
            "terrain": {"id": "terreno", "tag": "", "original": None, **terrain}
            if isinstance(terrain, dict)
            else terrain,
        }

    @classmethod
    def _migrate_before_v16(cls, document: dict[str, Any]) -> dict[str, Any]:
        """Migrações v1 → … → v16."""
        version = document.get("schemaVersion", document.get("schema_version"))
        if isinstance(version, bool) or version not in (
            1,
            2,
            3,
            4,
            5,
            6,
            7,
            8,
            9,
            10,
            11,
            12,
            13,
            14,
            15,
        ):
            return document
        # v15 → v16: modelo arquitetônico (vazio nos documentos antigos) e altura do plano de
        # corte da arquitetura nas plantas (1,20 m, limitada à faixa da planta).
        document = cls._migrate_v15(document)
        if version == 15:
            return document
        # v14 → v15: vistas de projeto (plantas, cortes, elevações e vistas 3D); documentos
        # antigos não têm vistas salvas.
        document = {"views": [], **document}
        if version == 14:
            return {**document, "schemaVersion": 16}
        # v13 → v14: cruzeta como elemento e famílias de cruzetas; só acrescenta tipos.
        if version == 13:
            return {**document, "schemaVersion": 16}
        # v12 → v13: famílias de bombas — campos opcionais na bomba e a lista de famílias
        # personalizadas, vazia nos documentos antigos.
        document = {"pumpFamilies": [], **document}
        if version == 12:
            return {**document, "schemaVersion": 16}
        # v11 → v12: limite, linhas de quebra e procedência da superfície do terreno. Um
        # terreno antigo é um levantamento por pontos, sem limite informado.
        terrain = document.get("terrain")
        document = {
            **document,
            "terrain": {"boundary": None, "breaklines": [], "source": survey_source(), **terrain}
            if isinstance(terrain, dict)
            else terrain,
        }
        if version == 11:
            return {**document, "schemaVersion": 16}
        # v10 → v11: configuração do ambiente Infra e referência altimétrica (não informada).
        # A escala que um projeto Infra usava na planta passa a ser a da Planta Infra.
        # v9 → v10: trechos retos do joelho e cotas das curvas ponta e bolsa (opcionais).
        # v8 → v9: valores IFC informados pelo usuário, por tipo e por ocorrência.
        # v7 → v8: famílias de reservatórios personalizadas no projeto.
        # v6 → v7: ressalto dos flanges e extremidades dos tubos (opcionais).
        # v5 → v6: forma construtiva, bocais e acessórios dos reservatórios (opcionais).
        # v4 → v5: filtro Y e furação opcional dos flanges. Nos dois casos o documento
        # já era válido.
        document = {"tankFamilies": [], "ifcTypes": {}, **document, "schemaVersion": 16}
        if version != 1 and version != 2 and version != 3:
            return cls._migrate_v10(document)
        # v3 → v4: anotações da planta baixa e escala do desenho.
        document = {**document, "annotations": [], "drawingScale": 50}
        if version != 1:
            # v2 → v3: novo tipo de válvula e largura opcional; o documento já era válido.
            return cls._migrate_v10(document)
        elements = document.get("elements")
        return cls._migrate_v10(cls._migrate_v1(document, elements))

    @staticmethod
    def _migrate_v15(document: dict[str, Any]) -> dict[str, Any]:
        views = document.get("views")
        migrated = {
            "architecture": {"types": [], "elements": []},
            **document,
            "schemaVersion": 16,
        }
        if isinstance(views, list):
            migrated["views"] = [
                {**view, "archCutHeight": default_arch_cut_height(view.get("cutHeight"))}
                if isinstance(view, dict)
                and view.get("kind") == "plan"
                and "archCutHeight" not in view
                else view
                for view in views
            ]
        return migrated

    @staticmethod
    def _migrate_v10(document: dict[str, Any]) -> dict[str, Any]:
        scale = document.get("drawingScale")
        infra_scale = (
            scale
            if document.get("discipline") == "infra"
            and isinstance(scale, int | float)
            and not isinstance(scale, bool)
            and scale > 0
            else 1000
        )
        georeference = document.get("georeference")
        return {
            "infra": default_infra_settings(infra_scale),
            **document,
            "georeference": {"verticalDatum": None, **georeference}
            if isinstance(georeference, dict)
            else georeference,
        }

    @staticmethod
    def _migrate_v1(document: dict[str, Any], elements: Any) -> dict[str, Any]:
        return {
            **document,
            "levels": [{"id": "nivel-0", "name": "Térreo", "elevation": 0}],
            "families": [],
            "georeference": None,
            "terrain": None,
            "elements": [
                {"familyId": None, **({"ends": {}} if e.get("kind") != "pipe" else {}), **e}
                if isinstance(e, dict)
                else e
                for e in elements
            ]
            if isinstance(elements, list)
            else elements,
        }
