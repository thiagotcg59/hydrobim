"""Validação estrutural/referencial; não verifica acoplamento geométrico de portas."""

from collections.abc import Callable
from math import atan, dist, hypot, isfinite, radians
from typing import Literal

from hydrobim_api.models.project import CamelModel, HydroElement, PipeSpec, Project

MIN_PIPE_LENGTH = 1e-3
# Mesmo valor de MIN_WALL_LENGTH (core/architecture/walls.ts).
MIN_WALL_LENGTH = 0.05
# Rótulos de ARCH_KIND_LABELS (core/architecture/derive.ts), em minúsculas.
ARCH_KIND_LABELS = {
    "wall": "parede",
    "slab": "laje",
    "flooring": "piso",
    "roof": "telhado",
    "door": "porta",
    "window": "janela",
}
SPEC_TOLERANCE = 1e-6
# Telhados: mesmos limites de core/architecture/roofs.ts.
MIN_ROOF_SIDE = 0.1
MIN_ROOF_SLOPE = atan(0.01)
MAX_ROOF_SLOPE = radians(75)
ROOF_SQUARE_TOLERANCE = 1e-6
ROOF_IFC_PREDEFINED = {"shed": "SHED_ROOF", "gable": "GABLE_ROOF"}
ROOF_SHAPE_LABELS = {"shed": "uma água", "gable": "duas águas"}
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


def _roof_boundary_problem(boundary: list) -> str | None:
    """Como `roofBoundaryProblem` (core): quatro cantos, lados mínimos e ângulos retos."""
    if len(boundary) != 4:
        return "o contorno do telhado precisa de quatro cantos (retângulo)"
    if any(not (isfinite(p.x) and isfinite(p.y)) for p in boundary):
        return "o contorno do telhado tem coordenadas inválidas"
    for i in range(4):
        a, b, c = boundary[i], boundary[(i + 1) % 4], boundary[(i + 2) % 4]
        side = (b.x - a.x, b.y - a.y)
        following = (c.x - b.x, c.y - b.y)
        if hypot(*side) < MIN_ROOF_SIDE:
            return (
                f"o lado {i + 1} do contorno é curto demais (mínimo de {MIN_ROOF_SIDE * 100:g} cm)"
            )
        if hypot(*following) < MIN_ROOF_SIDE:
            continue
        cosine = (side[0] * following[0] + side[1] * following[1]) / (
            hypot(*side) * hypot(*following)
        )
        if abs(cosine) > ROOF_SQUARE_TOLERANCE:
            return (
                "o contorno do telhado precisa ser retangular (só telhados de uma e de duas "
                "águas sobre retângulo são modelados)"
            )
    return None


def _roof_slope_problem(slope: float) -> str | None:
    if slope < MIN_ROOF_SLOPE - 1e-12:
        return (
            "a inclinação mínima do telhado é de 1 % (cobertura plana não é modelada como telhado)"
        )
    if slope > MAX_ROOF_SLOPE + 1e-12:
        return "a inclinação máxima do telhado é de 75°"
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
    _validate_architecture(project, level_ids, seen_ids, add)
    return issues


def _validate_architecture(
    project: Project, level_ids: set[str], hydraulic_ids: set[str], add: Callable[..., None]
) -> None:
    """Integridade referencial da arquitetura (esquema v16), como `archIntegrityProblem`.

    Ficam só no cliente as verificações que dependem da geometria derivada: polígonos de
    lajes, revestimentos e ambientes (contorno simples, aberturas contidas) e o vão de portas
    e janelas cabendo no trecho livre da parede hospedeira, já descontados os encontros com
    as paredes vizinhas (`OPENING_DOES_NOT_FIT`).
    """
    architecture = project.architecture
    types = {}
    for arch_type in architecture.types:
        if arch_type.id in types:
            add("ARCH_DUPLICATE_TYPE", f'Tipo duplicado: "{arch_type.name}".', [])
        else:
            types[arch_type.id] = arch_type
        # Produto de fabricante só com fonte identificada; nada é presumido.
        if not arch_type.generic and arch_type.source is None:
            add(
                "ARCH_SOURCE_REQUIRED",
                f'"{arch_type.name}" é produto de fabricante: informe a fonte (catálogo, '
                "edição, página e URL) ou marque o tipo como genérico.",
                [],
            )
        # A tipologia do telhado e o tipo predefinido IFC não se contradizem.
        if (
            arch_type.category == "roof"
            and arch_type.ifc_predefined_type != ROOF_IFC_PREDEFINED[arch_type.shape]
        ):
            add(
                "ROOF_TYPE_MISMATCH",
                f'"{arch_type.name}": telhado de {ROOF_SHAPE_LABELS[arch_type.shape]} tem o '
                f"tipo predefinido IFC {ROOF_IFC_PREDEFINED[arch_type.shape]}.",
                [],
            )

    walls: set[str] = set()
    seen: set[str] = set()
    for element in architecture.elements:
        if element.id in seen:
            add("ARCH_DUPLICATE_ID", f"Identificador duplicado ({element.id}).", [element.id])
        elif element.kind == "wall":
            # Como no cliente, vale a primeira ocorrência do identificador.
            walls.add(element.id)
        seen.add(element.id)
        # Os identificadores são únicos no projeto inteiro, não só dentro da arquitetura.
        if element.id in hydraulic_ids:
            add("DUPLICATE_ID", f"Identificador duplicado: {element.id}.", [element.id])
        if element.kind != "space":
            arch_type = types.get(element.type_id)
            if arch_type is None:
                add("ARCH_TYPE_NOT_FOUND", f'"{element.name}" não tem tipo.', [element.id])
            elif arch_type.category != element.kind:
                add(
                    "ARCH_TYPE_MISMATCH",
                    f'O tipo "{arch_type.name}" não é de {ARCH_KIND_LABELS[element.kind]}.',
                    [element.id],
                )
        if element.kind in ("door", "window"):
            continue
        if element.level_id not in level_ids:
            add(
                "LEVEL_NOT_FOUND",
                f'"{element.name}" referencia um nível inexistente.',
                [element.id],
            )
        if element.kind == "wall":
            length = dist((element.start.x, element.start.y), (element.end.x, element.end.y))
            if length < MIN_WALL_LENGTH:
                add(
                    "WALL_TOO_SHORT",
                    f'"{element.name}" ficaria sem comprimento '
                    f"(mínimo de {MIN_WALL_LENGTH * 100:g} cm).",
                    [element.id],
                )
        if element.kind == "roof":
            if problem := _roof_boundary_problem(element.boundary):
                add("ROOF_BOUNDARY_INVALID", f'"{element.name}": {problem}.', [element.id])
            elif problem := _roof_slope_problem(element.slope):
                add("ROOF_SLOPE_INVALID", f'"{element.name}": {problem}.', [element.id])

    for element in architecture.elements:
        if element.kind in ("door", "window") and element.host_id not in walls:
            add("HOST_NOT_FOUND", f'"{element.name}" não tem parede hospedeira.', [element.id])
