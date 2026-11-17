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
SCHEMA_VERSION = 3


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
Material = Literal["pvc", "hdpe", "ductileIron", "carbonSteel"]
JointType = Literal["solventWeld", "socketSpigot", "buttFusion", "buttWeld", "flanged", "threaded"]
ValveType = Literal["gate", "globe", "ball", "butterfly", "check", "airRelease", "pressureReducing"]
EndType = Literal["plain", "socket", "flange"]
SystemKind = Literal[
    "domesticColdWater", "domesticHotWater", "fireProtection", "waterSupply", "other"
]
Discipline = Literal["mep", "infra"]
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


class Tank(FittingBase):
    kind: Literal["tank"]
    diameter: PositiveNumber
    height: PositiveNumber
    outlet_height: NonNegativeNumber
    inlet_height: NonNegativeNumber
    nozzle_length: PositiveNumber


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


class Units(CamelModel):
    length: Literal["m"]
    angle: Literal["rad"]


class Project(CamelModel):
    format: Literal["hydrobim-project"]
    schema_version: Annotated[Literal[3], BeforeValidator(_json_number)]
    id: NonEmptyString
    name: str
    discipline: Discipline
    units: Units
    created_at: str
    updated_at: str
    systems: Annotated[list[HydraulicSystem], Field(min_length=1)]
    levels: list[Level]
    families: list[FittingFamily]
    georeference: Georeference | None
    terrain: Terrain | None
    elements: list[HydroElement]
    connections: list[Connection]

    @model_validator(mode="before")
    @classmethod
    def migrate(cls, document: Any) -> Any:
        """Mesmas migrações de core/serialization.ts (v1 → v2 → v3), sem mutar o documento."""
        if not isinstance(document, dict):
            return document
        version = document.get("schemaVersion", document.get("schema_version"))
        if isinstance(version, bool) or version not in (1, 2):
            return document
        if version == 2:
            # v2 → v3: novo tipo de válvula e largura opcional; o documento já é válido.
            return {**document, "schemaVersion": 3}
        elements = document.get("elements")
        return {
            **document,
            "schemaVersion": 3,
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
