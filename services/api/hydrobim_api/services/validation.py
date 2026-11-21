"""Validação estrutural/referencial; não verifica acoplamento geométrico de portas."""

from math import dist
from typing import Literal

from hydrobim_api.models.project import CamelModel, HydroElement, PipeSpec, Project

MIN_PIPE_LENGTH = 1e-3
SPEC_TOLERANCE = 1e-6
VALID_PORTS = {
    "pipe": frozenset({"start", "end"}),
    "elbow": frozenset({"a", "b"}),
    "tee": frozenset({"a", "b", "branch"}),
    "cross": frozenset({"a", "b", "branch", "branch2"}),
    "reducer": frozenset({"a", "b"}),
    "valve": frozenset({"a", "b"}),
    "pump": frozenset({"a", "b"}),
    "tank": frozenset({"a", "b"}),
}


def valid_ports(element: HydroElement) -> frozenset[str]:
    if element.kind == "valve" and element.valve_type == "airRelease":
        return frozenset({"a"})
    if element.kind == "tank" and element.nozzles:
        # Cada bocal adicional é uma porta, identificada pelo id do bocal.
        return VALID_PORTS["tank"] | {nozzle.id for nozzle in element.nozzles}
    return VALID_PORTS[element.kind]


class ValidationIssue(CamelModel):
    severity: Literal["error", "warning"]
    code: str
    message: str
    element_ids: list[str]


def _spec_problem(spec: PipeSpec) -> str | None:
    if spec.inner_diameter >= spec.outer_diameter:
        return "o diâmetro interno deve ser menor que o externo"
    expected = spec.outer_diameter - 2 * spec.wall_thickness
    if abs(expected - spec.inner_diameter) > SPEC_TOLERANCE:
        return "diâmetro interno incoerente com o diâmetro externo e a espessura de parede"
    return None


def validate_project(project: Project) -> list[ValidationIssue]:
    """Retorna todos os problemas sem modificar o projeto recebido."""
    issues: list[ValidationIssue] = []

    def add(code: str, message: str, ids: list[str], severity: str = "error") -> None:
        issues.append(
            ValidationIssue(severity=severity, code=code, message=message, element_ids=ids)
        )

    elements = {element.id: element for element in project.elements}
    system_ids = {system.id for system in project.systems}
    seen_ids: set[str] = set()
    for element in project.elements:
        if element.id in seen_ids:
            add("DUPLICATE_ID", f"Identificador duplicado: {element.id}.", [element.id])
        seen_ids.add(element.id)
        if element.system_id not in system_ids:
            add(
                "SYSTEM_NOT_FOUND",
                f'"{element.name}" referencia um sistema hidráulico inexistente.',
                [element.id],
            )
        if element.kind == "pipe":
            length = dist(
                (element.start.x, element.start.y, element.start.z),
                (element.end.x, element.end.y, element.end.z),
            )
            if length < MIN_PIPE_LENGTH:
                add("PIPE_TOO_SHORT", f'"{element.name}" não tem comprimento.', [element.id])
            # Tubos com flanges: só flange maior que o tubo, e os flanges cabem no comprimento.
            flanges = list((element.ends or {}).values())
            if any(
                end.type != "flange" or end.outer_diameter <= element.spec.outer_diameter
                for end in flanges
            ):
                add(
                    "INVALID_PIPE_END",
                    f'"{element.name}" tem extremidade incompatível com o tubo '
                    "(em tubos, só flange maior que o diâmetro externo).",
                    [element.id],
                )
            elif flanges and length < sum(end.length for end in flanges) + MIN_PIPE_LENGTH:
                add(
                    "PIPE_TOO_SHORT",
                    f'"{element.name}" é curto demais para os flanges das extremidades.',
                    [element.id],
                )
        specs = [element.spec]
        if element.kind == "reducer":
            specs.append(element.outlet_spec)
        if element.kind == "tank" and element.nozzles:
            specs.extend(nozzle.spec for nozzle in element.nozzles)
        for spec in specs:
            if problem := _spec_problem(spec):
                add("INVALID_SPEC", f'"{element.name}": {problem}.', [element.id])
        if element.kind == "reducer" and element.spec.dn == element.outlet_spec.dn:
            add(
                "REDUCER_SAME_DN",
                f'"{element.name}" tem o mesmo diâmetro nominal nas duas extremidades.',
                [element.id],
                "warning",
            )

    # Tuplas evitam colisões se ids contiverem os separadores usados no frontend.
    used_ports: set[tuple[str, str]] = set()
    seen_pairs: set[tuple[tuple[str, str], ...]] = set()
    for connection in project.connections:
        refs = (connection.a, connection.b)
        ids = [ref.element_id for ref in refs]
        if any(
            ref.element_id not in elements
            or ref.port_id not in valid_ports(elements[ref.element_id])
            for ref in refs
        ):
            add(
                "DANGLING_CONNECTION",
                "Conexão referencia um elemento ou porta inexistente.",
                [element_id for element_id in ids if element_id in elements],
            )
            continue
        if connection.a.element_id == connection.b.element_id:
            add(
                "SAME_ELEMENT",
                f'"{elements[connection.a.element_id].name}" está conectado a ele mesmo.',
                [connection.a.element_id],
            )
        keys = {(ref.element_id, ref.port_id) for ref in refs}
        pair = tuple(sorted(keys))
        if pair in seen_pairs:
            add("DUPLICATE_CONNECTION", "Conexão duplicada entre as mesmas portas.", ids)
        seen_pairs.add(pair)
        for key in sorted(keys):
            if key in used_ports:
                add(
                    "PORT_OVERUSED",
                    f'Uma porta de "{elements[key[0]].name}" participa de mais de uma conexão.',
                    [key[0]],
                )
            used_ports.add(key)

    for annotation in project.annotations:
        if annotation.kind == "tag" and annotation.element_id not in elements:
            add(
                "DANGLING_ANNOTATION",
                "Há uma etiqueta na planta que referencia um elemento inexistente.",
                [],
            )

    # Vistas de projeto (esquema v15): identificadores únicos e planta de nível existente.
    level_ids = {level.id for level in project.levels}
    seen_views: set[str] = set()
    for view in project.views:
        if view.id in seen_views:
            add("DUPLICATE_VIEW", f'Vista duplicada: "{view.name}".', [])
        seen_views.add(view.id)
        if view.kind == "plan" and view.level_id not in level_ids:
            add(
                "DANGLING_VIEW_LEVEL",
                f'A planta "{view.name}" referencia um nível inexistente.',
                [],
            )
    return issues
