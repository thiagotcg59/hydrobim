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
)
from pydantic.alias_generators import to_camel

PROJECT_FORMAT = "hydrobim-project"
SCHEMA_VERSION = 1


def _json_number(value: Any) -> int | float:
    """Zod aceita números JSON, sem converter strings ou booleanos."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("O valor deve ser um número.")
    return value


FiniteNumber = Annotated[float, Field(allow_inf_nan=False)]
PositiveNumber = Annotated[FiniteNumber, Field(gt=0)]
NonEmptyString = Annotated[str, Field(min_length=1)]
# JSON/JavaScript não distingue 1 de 1.0; strict=False só após conferir o tipo.
NonNegativeInteger = Annotated[int, Field(ge=0, strict=False), BeforeValidator(_json_number)]
Material = Literal["pvc", "hdpe", "ductileIron", "carbonSteel"]
JointType = Literal["solventWeld", "socketSpigot", "buttFusion", "buttWeld", "flanged", "threaded"]
ValveType = Literal["gate", "globe", "ball", "butterfly", "check"]
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


class ElementBase(CamelModel):
    id: NonEmptyString
    name: str
    system_id: NonEmptyString
    spec: PipeSpec
    properties: dict[str, PropertyValue]
    manufacturing: Manufacturing
    meta: ElementMeta


class Pipe(ElementBase):
    kind: Literal["pipe"]
    start: Vec3
    end: Vec3


class Elbow(ElementBase):
    kind: Literal["elbow"]
    placement: Placement
    angle: PositiveNumber
    bend_radius: PositiveNumber


class Tee(ElementBase):
    kind: Literal["tee"]
    placement: Placement
    run_length: PositiveNumber
    branch_length: PositiveNumber


class Reducer(ElementBase):
    kind: Literal["reducer"]
    placement: Placement
    outlet_spec: PipeSpec
    length: PositiveNumber


class Valve(ElementBase):
    kind: Literal["valve"]
    placement: Placement
    valve_type: ValveType
    length: PositiveNumber


HydroElement = Annotated[Pipe | Elbow | Tee | Reducer | Valve, Field(discriminator="kind")]


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


class Units(CamelModel):
    length: Literal["m"]
    angle: Literal["rad"]


class Project(CamelModel):
    format: Literal["hydrobim-project"]
    schema_version: Annotated[Literal[1], BeforeValidator(_json_number)]
    id: NonEmptyString
    name: str
    discipline: Discipline
    units: Units
    created_at: str
    updated_at: str
    systems: Annotated[list[HydraulicSystem], Field(min_length=1)]
    elements: list[HydroElement]
    connections: list[Connection]
