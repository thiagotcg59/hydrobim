"""Espelho de packages/core/src/schema.ts (fonte única de verdade).

Objetos ignoram campos extras, como z.object(); números não aceitam strings,
booleanos, NaN ou infinito. Timestamps são strings livres, conforme o schema.
"""

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
SCHEMA_VERSION = 8


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
    "gate", "globe", "ball", "butterfly", "check", "airRelease", "pressureReducing", "strainer"
]
EndType = Literal["plain", "socket", "flange"]
SystemKind = Literal[
    "domesticColdWater", "domesticHotWater", "fireProtection", "waterSupply", "other"
]
Discipline = Literal["mep", "infra"]
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


class Elbow(FittingBase):
    kind: Literal["elbow"]
    angle: PositiveNumber
    bend_radius: PositiveNumber


class Tee(FittingBase):
    kind: Literal["tee"]
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


class Pump(FittingBase):
    kind: Literal["pump"]
    discharge_spec: PipeSpec
    length: PositiveNumber
    discharge_offset: PositiveNumber
    discharge_height: PositiveNumber
    rated_flow: PositiveNumber = Field(default=None, validate_default=False)
    rated_head: PositiveNumber = Field(default=None, validate_default=False)


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


HydroElement = Annotated[
    Pipe | Elbow | Tee | Reducer | Valve | Pump | Tank, Field(discriminator="kind")
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
    center_to_branch: PositiveNumber = Field(default=None, validate_default=False)
    length: PositiveNumber = Field(default=None, validate_default=False)
    height: PositiveNumber = Field(default=None, validate_default=False)
    handwheel_diameter: PositiveNumber = Field(default=None, validate_default=False)
    width: PositiveNumber = Field(default=None, validate_default=False)
    end: FamilyEnd = Field(default=None, validate_default=False)
    end2: FamilyEnd = Field(default=None, validate_default=False)


class FittingFamily(CamelModel):
    id: NonEmptyString
    name: str
    kind: Literal["elbow", "tee", "reducer", "valve"]
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


class Terrain(CamelModel):
    name: str
    points: list[Vec3]
    triangles: list[NonNegativeInteger]


class Point2(CamelModel):
    """Ponto da planta (plano XY), em metros."""

    x: FiniteNumber
    y: FiniteNumber


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


class Units(CamelModel):
    length: Literal["m"]
    angle: Literal["rad"]


class Project(CamelModel):
    format: Literal["hydrobim-project"]
    schema_version: Annotated[Literal[8], BeforeValidator(_json_number)]
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
    georeference: Georeference | None
    terrain: Terrain | None
    elements: list[HydroElement]
    connections: list[Connection]
    annotations: list[Annotation]
    drawing_scale: PositiveNumber

    @model_validator(mode="before")
    @classmethod
    def migrate(cls, document: Any) -> Any:
        """Mesmas migrações de core/serialization.ts (v1 → … → v8), sem mutar o documento."""
        if not isinstance(document, dict):
            return document
        version = document.get("schemaVersion", document.get("schema_version"))
        if isinstance(version, bool) or version not in (1, 2, 3, 4, 5, 6, 7):
            return document
        # v7 → v8: famílias de reservatórios personalizadas no projeto.
        # v6 → v7: ressalto dos flanges e extremidades dos tubos (opcionais).
        # v5 → v6: forma construtiva, bocais e acessórios dos reservatórios (opcionais).
        # v4 → v5: filtro Y e furação opcional dos flanges. Nos dois casos o documento
        # já era válido.
        document = {"tankFamilies": [], **document, "schemaVersion": 8}
        if version in (4, 5, 6, 7):
            return document
        # v3 → v4: anotações da planta baixa e escala do desenho.
        document = {**document, "annotations": [], "drawingScale": 50}
        if version != 1:
            # v2 → v3: novo tipo de válvula e largura opcional; o documento já era válido.
            return document
        elements = document.get("elements")
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
