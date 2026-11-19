"""Gera `packages/ifc/src/bim/schemaData.ts` a partir do esquema IFC 4.3 do IfcOpenShell.

A tabela resultante (entidades, tipos predefinidos e conjuntos de propriedades padrão da
buildingSMART) é a referência normativa usada pela validação do editor. Nada nela é
digitado à mão: rode este script sempre que a lista de entidades ou conjuntos mudar.

    cd services/api
    uv run python scripts/generate_ifc_schema_data.py
"""

import json
import re
from pathlib import Path

import ifcopenshell
import ifcopenshell.util.pset

SCHEMA = "IFC4X3_ADD2"
TARGET = Path(__file__).resolve().parents[3] / "packages" / "ifc" / "src" / "bim" / "schemaData.ts"

# Ocorrências usadas pela exportação e pela classificação da biblioteca.
OCCURRENCES = [
    "IfcPipeSegment",
    "IfcPipeFitting",
    "IfcValve",
    "IfcPump",
    "IfcTank",
    "IfcFilter",
    "IfcFlowMeter",
    "IfcSensor",
    "IfcActuator",
    "IfcDiscreteAccessory",
    "IfcDistributionChamberElement",
]
OTHERS = ["IfcDistributionPort", "IfcDistributionSystem"]
PROPERTY_SETS = re.compile(
    r"^(Pset|Qto)_(PipeSegment|PipeFitting|PipeConnection|Valve|Pump|Filter|Tank|ElementSize"
    r"|Manufacturer|DistributionPort|DistributionSystem)"
)


def ancestors(declaration):
    names = []
    current = declaration.supertype()
    while current is not None:
        names.append(current.name())
        current = current.supertype()
    return names


def predefined_types(declaration):
    for attribute in declaration.all_attributes():
        if attribute.name() == "PredefinedType":
            enumeration = attribute.type_of_attribute().declared_type()
            return list(enumeration.enumeration_items())
    return []


def entity(schema, name, type_entity=None):
    declaration = schema.declaration_by_name(name)
    data = {
        "ancestors": ancestors(declaration),
        "predefinedTypes": predefined_types(declaration),
    }
    if type_entity:
        data["typeEntity"] = type_entity
    return data


def property_sets():
    template = ifcopenshell.util.pset.get_template("IFC4X3")
    result = {}
    for file in template.templates:
        for item in file.by_type("IfcPropertySetTemplate"):
            if not PROPERTY_SETS.match(item.Name) or "PHistory" in item.Name:
                continue
            properties = {}
            for prop in item.HasPropertyTemplates:
                if not prop.is_a("IfcSimplePropertyTemplate"):
                    continue
                entry = {"kind": prop.TemplateType, "type": prop.PrimaryMeasureType}
                if prop.Enumerators:
                    entry["enumeration"] = {
                        "name": prop.Enumerators.Name,
                        "values": [v.wrappedValue for v in prop.Enumerators.EnumerationValues],
                    }
                properties[prop.Name] = entry
            result[item.Name] = {
                "applicable": item.ApplicableEntity.split(","),
                "templateType": item.TemplateType,
                "properties": properties,
            }
    return dict(sorted(result.items()))


def main():
    schema = ifcopenshell.ifcopenshell_wrapper.schema_by_name(SCHEMA)
    entities = {}
    for name in OCCURRENCES:
        entities[name] = entity(schema, name, f"{name}Type")
        entities[f"{name}Type"] = entity(schema, f"{name}Type")
    for name in OTHERS:
        entities[name] = entity(schema, name)
    body = "\n".join(
        [
            "// GERADO por services/api/scripts/generate_ifc_schema_data.py a partir do esquema",
            f"// {SCHEMA} e dos modelos de conjuntos de propriedades do IfcOpenShell",
            f"// {ifcopenshell.version}. Não editar à mão.",
            "",
            f"export const IFC_SCHEMA_ID = '{SCHEMA}';",
            "",
            "export interface IfcEntityDefinition {",
            "  /** Supertipos, do mais próximo ao mais geral. */",
            "  readonly ancestors: readonly string[];",
            "  readonly predefinedTypes: readonly string[];",
            "  /** Entidade de tipo correspondente (`Ifc…Type`), nas ocorrências. */",
            "  readonly typeEntity?: string;",
            "}",
            "",
            "export interface IfcPropertyTemplate {",
            "  /** `P_SINGLEVALUE`, `P_ENUMERATEDVALUE`, `P_BOUNDEDVALUE`, `Q_LENGTH`… */",
            "  readonly kind: string;",
            "  /** Tipo de valor IFC (`IfcLabel`…); `null` nas quantidades. */",
            "  readonly type: string | null;",
            "  readonly enumeration?: {",
            "    readonly name: string;",
            "    readonly values: readonly string[];",
            "  };",
            "}",
            "",
            "export interface IfcPropertySetTemplate {",
            "  /** `Entidade` ou `Entidade/TIPOPREDEFINIDO`. */",
            "  readonly applicable: readonly string[];",
            "  readonly templateType: string;",
            "  readonly properties: Readonly<Record<string, IfcPropertyTemplate>>;",
            "}",
            "",
            "export const IFC_ENTITIES: Readonly<Record<string, IfcEntityDefinition>> = "
            + json.dumps(entities, indent=2, ensure_ascii=False)
            + ";",
            "",
            "export const IFC_PROPERTY_SETS: Readonly<Record<string, IfcPropertySetTemplate>> = "
            + json.dumps(property_sets(), indent=2, ensure_ascii=False)
            + ";",
            "",
        ]
    )
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(body, encoding="utf-8", newline="\n")
    print(f"{TARGET} atualizado.")


if __name__ == "__main__":
    main()
