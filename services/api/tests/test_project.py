import json
from copy import deepcopy

import pytest
from pydantic import ValidationError

from hydrobim_api.models.project import Project
from hydrobim_api.services.validation import validate_project


@pytest.mark.parametrize(
    "manufacturing", [{}, {"manufacturer": "Fabricante"}, {"model": "", "partNumber": "P-1"}]
)
def test_round_trip(project_document, manufacturing):
    project_document["elements"][0]["manufacturing"] = manufacturing
    project = Project.model_validate(project_document)
    assert project.model_dump(by_alias=True) == project_document
    assert project.model_dump() == project_document
    assert json.loads(project.model_dump_json(by_alias=True)) == project_document


def test_python_attributes_accept_snake_case(project_document):
    project = Project.model_validate(project_document)
    assert project.schema_version == 13
    assert project.elements[0].spec.outer_diameter == 0.025
    assert Project.model_validate(project.model_dump(by_alias=False)) == project


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("schemaVersion",), 14),
        (("schemaVersion",), True),
        (("schemaVersion",), "1"),
        (("units", "length"), "mm"),
        (("units", "angle"), "deg"),
        (("systems",), []),
        (("systems", 0, "kind"), "unknown"),
        (("systems", 0, "color"), "red"),
        (("systems", 0, "visible"), None),
        (("elements", 2, "branchSpec"), None),
        (("elements", 3, "height"), 0),
        (("elements", 3, "handwheelDiameter"), None),
        (("discipline",), "unknown"),
        (("id",), ""),
        (("elements", 0, "spec", "material"), "copper"),
        (("elements", 0, "spec", "jointType"), "unknown"),
        (("elements", 0, "spec", "dn"), "20"),
        (("elements", 0, "spec", "dn"), True),
        (("elements", 0, "spec", "innerDiameter"), 0),
        (("elements", 0, "spec", "wallThickness"), -1),
        (("elements", 0, "spec", "specificationId"), ""),
        (("elements", 0, "manufacturing", "manufacturer"), None),
        (("elements", 0, "manufacturing", "model"), None),
        (("elements", 0, "manufacturing", "partNumber"), None),
        (("elements", 0, "meta", "revision"), -1),
        (("elements", 0, "meta", "revision"), 1.5),
        (("elements", 0, "meta", "revision"), "1"),
        (("elements", 0, "meta", "revision"), True),
        (("elements", 0, "properties", "bad"), None),
        (("elements", 0, "properties", "bad"), []),
        (("elements", 0, "properties", "bad"), {}),
        (("elements", 1, "angle"), 0),
        (("elements", 1, "bendRadius"), -1),
        (("elements", 1, "placement", "rotation", "w"), float("inf")),
        (("elements", 2, "runLength"), 0),
        (("elements", 2, "branchLength"), -1),
        (("elements", 3, "valveType"), "unknown"),
        (("elements", 3, "length"), 0),
        (("elements", 4, "length"), -1),
        (("elements", 4, "outletSpec", "dn"), 0),
        (("connections", 0, "a", "portId"), ""),
        (("connections", 0, "b", "elementId"), ""),
    ],
)
def test_schema_constraints(project_document, path, value):
    target = project_document
    for segment in path[:-1]:
        target = target[segment]
    target[path[-1]] = value
    with pytest.raises(ValidationError):
        Project.model_validate(project_document)


def test_nullable_pressure_class_is_required(project_document):
    del project_document["elements"][0]["spec"]["pressureClass"]
    with pytest.raises(ValidationError):
        Project.model_validate(project_document)


def test_zod_permits_empty_strings_and_integral_floats(project_document):
    project_document["name"] = ""
    project_document["createdAt"] = "not-an-iso-date"
    project_document["schemaVersion"] = 13.0
    project_document["elements"][0]["meta"]["revision"] = 1.0
    project_document["elements"][0]["spec"]["standard"] = ""
    assert Project.model_validate(project_document).model_dump(by_alias=True) == project_document


def test_unknown_fields_are_stripped_like_zod(project_document):
    project_document["unknown"] = "ignored"
    project_document["elements"][0]["spec"]["unknown"] = "ignored"
    output = Project.model_validate(project_document).model_dump(by_alias=True)
    assert "unknown" not in output
    assert "unknown" not in output["elements"][0]["spec"]


def test_migrates_v1_without_changing_input(project_document):
    legacy = deepcopy(project_document)
    legacy["schemaVersion"] = 1
    for key in ("levels", "families", "georeference", "terrain", "annotations", "drawingScale"):
        del legacy[key]
    for element in legacy["elements"]:
        del element["familyId"]
        element.pop("ends", None)
    before = deepcopy(legacy)
    assert Project.model_validate(legacy).model_dump() == project_document
    assert legacy == before


def test_migrates_v2_without_changing_input(project_document):
    legacy = deepcopy(project_document)
    legacy["schemaVersion"] = 2
    del legacy["annotations"], legacy["drawingScale"]
    before = deepcopy(legacy)
    assert Project.model_validate(legacy).model_dump() == project_document
    assert legacy == before


def test_migrates_v3_adding_annotations_and_scale(project_document):
    legacy = deepcopy(project_document)
    legacy["schemaVersion"] = 3
    del legacy["annotations"], legacy["drawingScale"]
    before = deepcopy(legacy)
    assert Project.model_validate(legacy).model_dump() == project_document
    assert legacy == before


def test_migrates_v4_without_changing_input(project_document):
    legacy = deepcopy(project_document)
    legacy["schemaVersion"] = 4
    before = deepcopy(legacy)
    assert Project.model_validate(legacy).model_dump() == project_document
    assert legacy == before


def test_migrates_v5_without_changing_input(project_document):
    legacy = deepcopy(project_document)
    legacy["schemaVersion"] = 5
    before = deepcopy(legacy)
    assert Project.model_validate(legacy).model_dump() == project_document
    assert legacy == before


def test_migrates_v6_without_changing_input(project_document):
    legacy = deepcopy(project_document)
    legacy["schemaVersion"] = 6
    before = deepcopy(legacy)
    assert Project.model_validate(legacy).model_dump() == project_document
    assert legacy == before


def test_migrates_v7_adding_tank_families(project_document):
    legacy = deepcopy(project_document)
    legacy["schemaVersion"] = 7
    del legacy["tankFamilies"]
    before = deepcopy(legacy)
    assert Project.model_validate(legacy).model_dump() == project_document
    assert legacy == before


def test_migrates_v8_adding_ifc_types(project_document):
    legacy = deepcopy(project_document)
    legacy["schemaVersion"] = 8
    del legacy["ifcTypes"]
    before = deepcopy(legacy)
    assert Project.model_validate(legacy).model_dump() == project_document
    assert legacy == before


def test_migrates_v9_without_changes(project_document):
    legacy = deepcopy(project_document)
    legacy["schemaVersion"] = 9
    before = deepcopy(legacy)
    assert Project.model_validate(legacy).model_dump() == project_document
    assert legacy == before


GEOREFERENCE_V10 = {
    "crsName": "SIRGAS 2000 / UTM zone 23S",
    "epsg": 31983,
    "eastings": 333287.0215,
    "northings": 7394586.0934,
    "orthogonalHeight": 760,
    "rotation": 0.3,
}


def test_migrates_v10_adding_infra_settings(project_document):
    legacy = deepcopy(project_document)
    legacy["schemaVersion"] = 10
    del legacy["infra"]
    before = deepcopy(legacy)
    assert Project.model_validate(legacy).model_dump() == project_document
    assert legacy == before


def test_migrates_v10_infra_scale_and_vertical_datum(project_document):
    legacy = deepcopy(project_document)
    legacy["schemaVersion"] = 10
    del legacy["infra"]
    legacy["discipline"] = "infra"
    legacy["drawingScale"] = 500
    legacy["georeference"] = dict(GEOREFERENCE_V10)
    migrated = Project.model_validate(legacy).model_dump()
    # A escala da planta de um projeto Infra passa a ser a da Planta Infra.
    assert migrated["infra"]["drawingScale"] == 500
    assert migrated["infra"]["basemap"]["sourceId"] is None
    # A georreferência é preservada; a referência altimétrica fica não informada.
    assert migrated["georeference"] == {**GEOREFERENCE_V10, "verticalDatum": None}
    assert "verticalDatum" not in legacy["georeference"]


TERRAIN_V11 = {
    "name": "Levantamento",
    "points": [
        {"x": 0, "y": 0, "z": 10},
        {"x": 10, "y": 0, "z": 10},
        {"x": 0, "y": 10, "z": 12},
    ],
    "triangles": [0, 1, 2],
}


def test_migrates_v11_terrain_as_survey_without_presumed_data(project_document):
    legacy = deepcopy(project_document)
    legacy["schemaVersion"] = 11
    legacy["terrain"] = deepcopy(TERRAIN_V11)
    before = deepcopy(legacy)
    migrated = Project.model_validate(legacy).model_dump()
    assert legacy == before
    assert migrated["schemaVersion"] == 13
    terrain = migrated["terrain"]
    assert terrain["points"] == TERRAIN_V11["points"]
    assert terrain["boundary"] is None
    assert terrain["breaklines"] == []
    # Nada é presumido: datum, exatidão, resolução e data ficam não informados.
    assert terrain["source"] == {
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


def test_terrain_requires_source_and_valid_boundary(project_document):
    terrain = {
        **deepcopy(TERRAIN_V11),
        "boundary": None,
        "breaklines": [],
        "source": {
            "kind": "dem",
            "provider": "GeoTIFF",
            "dataset": "gleba.tif",
            "horizontalCrs": "EPSG:31983",
            "verticalDatum": None,
            "resolution": 30,
            "verticalAccuracy": None,
            "acquiredAt": "2026-11-19T12:00:00.000Z",
            "attribution": None,
            "notes": None,
        },
    }
    project_document["terrain"] = terrain
    assert Project.model_validate(project_document).model_dump() == project_document
    # Um anel de limite precisa de três vértices; a resolução, quando informada, é positiva.
    project_document["terrain"] = {**terrain, "boundary": [terrain["points"][:2]]}
    with pytest.raises(ValidationError):
        Project.model_validate(project_document)
    project_document["terrain"] = {**terrain, "source": {**terrain["source"], "resolution": 0}}
    with pytest.raises(ValidationError):
        Project.model_validate(project_document)
    del terrain["source"]
    project_document["terrain"] = terrain
    with pytest.raises(ValidationError):
        Project.model_validate(project_document)


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("infra", "drawingScale"), 0),
        (("infra", "basemap", "opacity"), 1.5),
        (("infra", "basemap", "sourceId"), ""),
        (("infra", "layers", "network"), None),
        (("infra", "labels"), {}),
    ],
)
def test_rejects_invalid_infra_settings(project_document, path, value):
    target = project_document
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    with pytest.raises(ValidationError):
        Project.model_validate(project_document)


def test_accepts_georeference_with_vertical_datum(project_document):
    project_document["georeference"] = {**GEOREFERENCE_V10, "verticalDatum": "Imbituba"}
    assert Project.model_validate(project_document).model_dump() == project_document
    project_document["georeference"]["verticalDatum"] = ""
    with pytest.raises(ValidationError):
        Project.model_validate(project_document)


def test_accepts_elbow_with_straight_legs(project_document):
    elbow = next(e for e in project_document["elements"] if e["kind"] == "elbow")
    elbow["straight"] = {"a": 0.0475, "b": 0.1222}
    assert Project.model_validate(project_document).model_dump() == project_document
    elbow["straight"] = {"a": -0.01, "b": 0.1}
    with pytest.raises(ValidationError):
        Project.model_validate(project_document)


def test_accepts_ifc_values_of_types_and_occurrences(project_document):
    key = "Pset_PipeSegmentOccurrence.InteriorRoughnessCoefficient"
    project_document["elements"][0]["ifc"] = {key: 0.0001, "Description": "Trecho A"}
    project_document["ifcTypes"] = {
        "pipe|generic|x|50|plain|plain": {"Pset_PipeSegmentTypeCommon.WorkingPressure": 600000}
    }
    project = Project.model_validate(project_document)
    assert project.elements[0].ifc[key] == 0.0001
    assert project.model_dump()["ifcTypes"] == project_document["ifcTypes"]
    project_document["ifcTypes"] = {"tipo": {"chave": [1, 2]}}
    with pytest.raises(ValidationError):
        Project.model_validate(project_document)


def _custom_tank_family():
    return {
        "id": "custom-tank-1",
        "name": "Taça da obra (personalizado)",
        "tankType": "gobletDry",
        "manufacturer": "Personalizado",
        "material": "Aço-carbono estrutural",
        "source": "Família personalizada neste projeto.",
        "page": 4,
        "description": "",
        "variants": [
            {
                "id": "custom-tank-1/a",
                "capacityL": 10000,
                "height": 7.5,
                "diameter": 1.91,
                "columnHeight": 4,
            }
        ],
        "capacityRangeL": [5000, 100000],
        "customDefaults": {"capacityL": 10000, "diameter": 1.91, "height": 7.1},
        "approximations": ["Espessura das chapas: não informada."],
        "remarks": [],
        "origin": "custom",
        "basedOn": "tramec-taca-sem-agua",
    }


def test_custom_tank_family_round_trips(project_document):
    project_document["tankFamilies"] = [_custom_tank_family()]
    project = Project.model_validate(project_document)
    assert project.model_dump(by_alias=True) == project_document
    assert project.tank_families[0].variants[0].capacity_l == 10000
    assert project.tank_families[0].capacity_range_l == [5000, 100000]


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("name", ""),
        ("tankType", "generic"),
        ("origin", "fabricante"),
        ("capacityRangeL", [5000]),
        ("variants", [{"id": "x", "capacityL": 0, "height": 1, "diameter": 1}]),
        ("variants", [{"id": "", "capacityL": 1, "height": 1, "diameter": 1}]),
        ("customDefaults", {"capacityL": 1, "diameter": 1}),
    ],
)
def test_rejects_invalid_tank_family(project_document, key, value):
    family = _custom_tank_family()
    family[key] = value
    project_document["tankFamilies"] = [family]
    with pytest.raises(ValidationError):
        Project.model_validate(project_document)


def _pn10_flange():
    """Flange PN 10 DN 50 da tabela única (Catálogo Geral, p. 246), em metros."""
    return {
        "type": "flange",
        "length": 0.019,
        "outerDiameter": 0.165,
        "boltCircle": 0.125,
        "boltCount": 4,
        "boltHoleDiameter": 0.019,
        "raisedFaceDiameter": 0.099,
        "raisedFaceHeight": 0.003,
    }


def test_flanged_pipe_round_trips(project_document):
    pipe = next(e for e in project_document["elements"] if e["kind"] == "pipe")
    pipe["familyId"] = "tubo-fofo-flanges-pn10"
    pipe["ends"] = {"start": _pn10_flange()}
    project = Project.model_validate(project_document)
    assert project.model_dump(by_alias=True) == project_document
    assert validate_project(project) == []
    # Tubo sem `ends` continua válido e a chave não é criada.
    del pipe["ends"]
    assert (
        "ends"
        not in Project.model_validate(project_document).model_dump(by_alias=True)["elements"][
            project_document["elements"].index(pipe)
        ]
    )


@pytest.mark.parametrize(
    ("patch", "code"),
    [
        ({"type": "socket"}, "INVALID_PIPE_END"),
        ({"outerDiameter": 0.01}, "INVALID_PIPE_END"),
        ({"length": 50.0}, "PIPE_TOO_SHORT"),
    ],
)
def test_incoherent_pipe_end_is_reported(project_document, patch, code):
    pipe = next(e for e in project_document["elements"] if e["kind"] == "pipe")
    pipe["ends"] = {"end": {**_pn10_flange(), **patch}}
    issues = validate_project(Project.model_validate(project_document))
    assert code in [issue.code for issue in issues]


@pytest.mark.parametrize("key", ["raisedFaceDiameter", "raisedFaceHeight"])
def test_raised_face_must_be_positive(project_document, key):
    pipe = next(e for e in project_document["elements"] if e["kind"] == "pipe")
    pipe["ends"] = {"start": {**_pn10_flange(), key: 0}}
    with pytest.raises(ValidationError):
        Project.model_validate(project_document)


def _catalog_tank(project_document):
    """Reservatório de catálogo (taça sem água na coluna) com um extravasor."""
    element = project_document["elements"][3]
    element["kind"] = "tank"
    del element["valveType"], element["length"]
    element.update(
        familyId="tramec-taca-sem-agua",
        manufacturing={"manufacturer": "TRAMEC", "model": "Taça 10.000 L"},
        diameter=1.91,
        height=8.3,
        outletHeight=0.3,
        inletHeight=0.3,
        nozzleLength=0.15,
        tankType="gobletDry",
        variantId="tramec-taca-sem-agua/10000-830-191-480",
        nominalCapacity=10,
        columnHeight=4.8,
        columnDiameter=0.955,
        coneHeight=0.382,
        compartments=1,
        accessories={
            "ladder": True,
            "ladderAzimuth": 1.5707963267948966,
            "cage": True,
            "guardrail": True,
            "guardrailHeight": 1.1,
            "manhole": True,
        },
        nozzles=[
            {
                "id": "extravasor",
                "role": "overflow",
                "height": 7.5,
                "azimuth": 0,
                "spec": deepcopy(element["spec"]),
            }
        ],
    )
    return element


def test_catalog_tank_round_trips(project_document):
    _catalog_tank(project_document)
    project = Project.model_validate(project_document)
    assert project.model_dump(by_alias=True) == project_document
    tank = project.elements[3]
    assert tank.tank_type == "gobletDry"
    assert tank.nozzles[0].role == "overflow"
    assert tank.accessories.guardrail_height == 1.1


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("tankType", "esferico"),
        ("variantId", ""),
        ("nominalCapacity", 0),
        ("columnHeight", -1),
        ("supportHeight", -0.1),
        ("supportType", "rodas"),
        ("compartments", 1.5),
        ("compartments", 0),
        ("shellThickness", "6mm"),
        ("nozzles", [{"id": "x", "role": "saida", "height": 1, "azimuth": 0}]),
        ("accessories", {"ladder": True}),
    ],
)
def test_rejects_invalid_catalog_tank(project_document, key, value):
    _catalog_tank(project_document)[key] = value
    with pytest.raises(ValidationError):
        Project.model_validate(project_document)


def test_tank_nozzle_is_a_valid_port(project_document):
    tank = _catalog_tank(project_document)
    # A conexão que usava a porta `b` passa a usar o bocal adicional.
    connection = next(
        c
        for c in project_document["connections"]
        if tank["id"] in (c["a"]["elementId"], c["b"]["elementId"])
    )
    side = "a" if connection["a"]["elementId"] == tank["id"] else "b"
    connection[side]["portId"] = "extravasor"
    assert validate_project(Project.model_validate(project_document)) == []
    connection[side]["portId"] = "bocal-inexistente"
    issues = validate_project(Project.model_validate(project_document))
    assert [issue.code for issue in issues] == ["DANGLING_CONNECTION"]


def test_gate_valve_with_rectangular_bonnet(project_document):
    valve = next(e for e in project_document["elements"] if e["kind"] == "valve")
    valve["valveType"] = "gate"
    valve["height"] = 0.323
    valve["width"] = 0.194
    valve["bonnetLength"] = 0.111
    project = Project.model_validate(project_document)
    assert project.model_dump(by_alias=True) == project_document
    valve["bonnetLength"] = 0
    with pytest.raises(ValidationError):
        Project.model_validate(project_document)


def test_y_strainer_with_drilled_flanges(project_document):
    valve = next(e for e in project_document["elements"] if e["kind"] == "valve")
    valve["valveType"] = "strainer"
    valve["height"] = 0.265
    valve["ends"] = {
        port: {
            "type": "flange",
            "length": 0.0239,
            "outerDiameter": 0.2286,
            "boltCircle": 0.1905,
            "boltCount": 8,
            "boltHoleDiameter": 0.01905,
        }
        for port in ("a", "b")
    }
    project = Project.model_validate(project_document)
    assert project.model_dump(by_alias=True) == project_document


def test_flow_meter_is_an_inline_valve_type(project_document):
    valve = next(e for e in project_document["elements"] if e["kind"] == "valve")
    valve["valveType"] = "flowMeter"
    valve["height"] = 0.2925
    project = Project.model_validate(project_document)
    assert project.model_dump(by_alias=True) == project_document
    valve["valveType"] = "meter"
    with pytest.raises(ValidationError):
        Project.model_validate(project_document)


@pytest.mark.parametrize("count", [0, -4, 2.5, "8", True])
def test_flange_bolt_count_must_be_a_positive_integer(project_document, count):
    valve = next(e for e in project_document["elements"] if e["kind"] == "valve")
    valve["ends"] = {
        "a": {
            "type": "flange",
            "length": 0.02,
            "outerDiameter": 0.2,
            "boltCircle": 0.16,
            "boltCount": count,
            "boltHoleDiameter": 0.018,
        }
    }
    with pytest.raises(ValidationError):
        Project.model_validate(project_document)


def test_plan_annotations_round_trip(project_document):
    project_document["drawingScale"] = 100
    project_document["annotations"] = [
        {
            "id": "cota-1",
            "kind": "dimension",
            "a": {"x": 0, "y": 0},
            "b": {"x": 1, "y": 0},
            "offset": 0.4,
            "mode": "aligned",
        },
        {
            "id": "texto-1",
            "kind": "text",
            "position": {"x": 2, "y": 1},
            "text": "CASA DE MÁQUINAS",
            "rotation": 0,
        },
        {
            "id": "chamada-1",
            "kind": "text",
            "position": {"x": 2, "y": 2},
            "text": "RECALQUE",
            "rotation": 0,
            "leader": {"x": 1, "y": 0},
        },
        {
            "id": "etiqueta-1",
            "kind": "tag",
            "elementId": "pipe-1",
            "position": {"x": 0.5, "y": 0.2},
        },
    ]
    project = Project.model_validate(project_document)
    assert project.model_dump(by_alias=True) == project_document
    assert validate_project(project) == []


@pytest.mark.parametrize(
    ("index", "key", "value"),
    [
        (0, "mode", "radial"),
        (0, "offset", "0.4"),
        (1, "text", ""),
        (3, "elementId", ""),
        (3, "kind", "balloon"),
    ],
)
def test_rejects_invalid_annotations(project_document, index, key, value):
    project_document["annotations"] = [
        {
            "id": "cota-1",
            "kind": "dimension",
            "a": {"x": 0, "y": 0},
            "b": {"x": 1, "y": 0},
            "offset": 0.4,
            "mode": "aligned",
        },
        {"id": "t", "kind": "text", "position": {"x": 2, "y": 1}, "text": "A", "rotation": 0},
        {"id": "u", "kind": "text", "position": {"x": 2, "y": 1}, "text": "B", "rotation": 0},
        {"id": "e", "kind": "tag", "elementId": "pipe-1", "position": {"x": 0.5, "y": 0.2}},
    ]
    project_document["annotations"][index][key] = value
    with pytest.raises(ValidationError):
        Project.model_validate(project_document)


def test_tag_of_missing_element_is_reported(project_document):
    project_document["annotations"] = [
        {"id": "e", "kind": "tag", "elementId": "nao-existe", "position": {"x": 0, "y": 0}}
    ]
    issues = validate_project(Project.model_validate(project_document))
    assert [issue.code for issue in issues] == ["DANGLING_ANNOTATION"]


def test_pressure_reducing_valve_with_width(project_document):
    valve = next(e for e in project_document["elements"] if e["kind"] == "valve")
    valve["valveType"] = "pressureReducing"
    valve["width"] = 0.255
    project = Project.model_validate(project_document)
    assert project.model_dump(by_alias=True) == project_document


def test_migrates_v12_adding_empty_pump_families(project_document):
    legacy = deepcopy(project_document)
    legacy["schemaVersion"] = 12
    del legacy["pumpFamilies"]
    before = deepcopy(legacy)
    migrated = Project.model_validate(legacy).model_dump(by_alias=True)
    assert legacy == before
    assert migrated == {**project_document, "schemaVersion": 13}


def _custom_pump_family():
    return {
        "id": "custom-pump-1",
        "name": "Bomba anfíbia (personalizado)",
        "pumpType": "amphibious",
        "manufacturer": "Personalizado",
        "frequencyHz": 60,
        "source": "Família personalizada neste projeto.",
        "page": 42,
        "description": "",
        "variants": [
            {
                "id": "custom-pump-1/r1-260-160l",
                "models": ["R1-260/20B", "R1-260/40B"],
                "frame": "160L",
                "suction": {"dn": 200, "pressureClass": "PN 40"},
                "discharge": {"dn": 200, "pressureClass": "PN 40"},
                "dimensions": {
                    "footOffset": 0.266,
                    "footSpan": 0.581,
                    "rearLength": 0.151,
                    "length": 0.998,
                    "footWidth": 0.34,
                    "footHoleDiameter": 0.027,
                    "axisHeight": 0.283,
                    "totalHeight": 0.543,
                },
                "stages": 1,
            }
        ],
        "approximations": [],
        "remarks": [],
        "origin": "custom",
        "basedOn": "higra-anfibia-estagio-unico-60hz",
    }


def test_custom_pump_family_round_trips(project_document):
    project_document["pumpFamilies"] = [_custom_pump_family()]
    project = Project.model_validate(project_document)
    assert project.pump_families[0].variants[0].dimensions.length == 0.998
    assert project.model_dump(by_alias=True)["pumpFamilies"] == [_custom_pump_family()]
    for path, value in (
        (("variants", 0, "models"), []),
        (("variants", 0, "stages"), 0),
        (("variants", 0, "dimensions", "footSpan"), -1),
        (("pumpType",), "generic"),
    ):
        family = _custom_pump_family()
        target = family
        for key in path[:-1]:
            target = target[key]
        target[path[-1]] = value
        project_document["pumpFamilies"] = [family]
        with pytest.raises(ValidationError):
            Project.model_validate(project_document)


def test_catalog_amphibious_pump_round_trips(client, project_document):
    """Esquema v13: bomba de catálogo, em linha, sem a posição do recalque da genérica."""
    element = project_document["elements"][3]
    element.update(
        kind="pump",
        dischargeSpec=element["spec"],
        familyId="higra-anfibia-estagio-unico-60hz",
        pumpType="amphibious",
        variantId="higra-anfibia-estagio-unico-60hz/r1-260-160l",
        stages=1,
        suctionFlangeClass="PN 40",
        dischargeFlangeClass="PN 40",
        length=0.998,
        footOffset=0.266,
        footSpan=0.581,
        rearLength=0.151,
        footWidth=0.34,
        footHoleDiameter=0.027,
        axisHeight=0.283,
        totalHeight=0.543,
    )
    dumped = Project.model_validate(project_document).model_dump(by_alias=True)["elements"][3]
    for field in (
        "pumpType",
        "variantId",
        "stages",
        "suctionFlangeClass",
        "dischargeFlangeClass",
        "length",
        "footOffset",
        "footSpan",
        "rearLength",
        "footWidth",
        "footHoleDiameter",
        "axisHeight",
        "totalHeight",
    ):
        assert dumped[field] == element[field], field
    assert "dischargeOffset" not in dumped
    assert "dischargeHeight" not in dumped
    response = client.post("/api/v1/projects/validate", json=project_document)
    assert response.status_code == 200

    # Tipo de bomba desconhecido e cota não positiva são recusados.
    for field, value in (("pumpType", "turbine"), ("footSpan", 0), ("stages", 1.5)):
        invalid = deepcopy(project_document)
        invalid["elements"][3][field] = value
        with pytest.raises(ValidationError):
            Project.model_validate(invalid)


@pytest.mark.parametrize("kind", ["pump", "tank", "valve"])
def test_equipment_and_single_port_air_release(client, project_document, kind):
    element = project_document["elements"][3]
    element["kind"] = kind
    if kind == "pump":
        element.update(dischargeSpec=element["spec"], dischargeOffset=0.2, dischargeHeight=0.3)
    elif kind == "tank":
        element.update(diameter=2, height=3, outletHeight=0, inletHeight=2, nozzleLength=0.15)
    else:
        element["valveType"] = "airRelease"
    response = client.post("/api/v1/projects/validate", json=project_document)
    assert response.status_code == 200
    assert response.json()["valid"] is (kind != "valve")
    if kind == "valve":
        assert {issue["code"] for issue in response.json()["issues"]} == {"DANGLING_CONNECTION"}
