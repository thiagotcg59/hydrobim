from copy import deepcopy

import pytest

from hydrobim_api.models.project import Project
from hydrobim_api.services.validation import validate_project

VALIDATE_URL = "/api/v1/projects/validate"


@pytest.mark.parametrize(
    "code",
    [
        "DUPLICATE_ID",
        "DANGLING_CONNECTION",
        "SAME_ELEMENT",
        "DUPLICATE_CONNECTION",
        "PORT_OVERUSED",
        "SYSTEM_NOT_FOUND",
        "PIPE_TOO_SHORT",
        "INVALID_SPEC",
    ],
)
def test_each_semantic_error(client, project_document, code):
    pipe = project_document["elements"][0]
    connection = project_document["connections"][0]
    if code == "DUPLICATE_ID":
        project_document["elements"].append(deepcopy(pipe))
    elif code == "DANGLING_CONNECTION":
        connection["a"]["elementId"] = "missing"
    elif code == "SAME_ELEMENT":
        connection["b"] = {"elementId": "pipe-1", "portId": "start"}
    elif code == "DUPLICATE_CONNECTION":
        project_document["connections"].append({**deepcopy(connection), "id": "duplicate"})
    elif code == "PORT_OVERUSED":
        project_document["connections"][1]["a"] = deepcopy(connection["a"])
    elif code == "SYSTEM_NOT_FOUND":
        pipe["systemId"] = "missing"
    elif code == "PIPE_TOO_SHORT":
        pipe["end"] = {**pipe["start"], "x": 0.0005}
    else:
        pipe["spec"]["innerDiameter"] = 0.022
    response = client.post(VALIDATE_URL, json=project_document)
    assert response.status_code == 200
    result = response.json()
    assert result["valid"] is False
    matching = [issue for issue in result["issues"] if issue["code"] == code]
    assert matching
    for issue in matching:
        assert set(issue) == {"severity", "code", "message", "elementIds"}
        assert issue["severity"] == "error"
        assert issue["message"]
        assert issue["elementIds"]


@pytest.mark.parametrize("element_index", range(6))
def test_invalid_port_for_each_kind(client, project_document, element_index):
    project_document["connections"] = [
        {
            "id": "invalid-port",
            "a": {
                "elementId": project_document["elements"][element_index]["id"],
                "portId": "unknown",
            },
            "b": {"elementId": "pipe-2", "portId": "end"},
        }
    ]
    result = client.post(VALIDATE_URL, json=project_document).json()
    assert result["valid"] is False
    assert [issue["code"] for issue in result["issues"]] == ["DANGLING_CONNECTION"]


def test_tee_branch_is_valid(client, project_document):
    project_document["connections"] = [
        {
            "id": "branch",
            "a": {"elementId": "tee-1", "portId": "branch"},
            "b": {"elementId": "pipe-1", "portId": "start"},
        }
    ]
    assert client.post(VALIDATE_URL, json=project_document).json()["valid"] is True


@pytest.mark.parametrize("same_id", [False, True])
def test_reversed_duplicate_connection_and_overused_ports(client, project_document, same_id):
    original = project_document["connections"][0]
    project_document["connections"].append(
        {
            "id": original["id"] if same_id else "reversed",
            "a": deepcopy(original["b"]),
            "b": deepcopy(original["a"]),
        }
    )
    result = client.post(VALIDATE_URL, json=project_document).json()
    assert result["valid"] is False
    codes = [issue["code"] for issue in result["issues"]]
    assert codes.count("DUPLICATE_CONNECTION") == 1
    assert codes.count("PORT_OVERUSED") == 2


@pytest.mark.parametrize("inner_diameter", [0.022, 0.025, 0.026])
def test_spec_consistency_and_smaller_inner_diameter(client, project_document, inner_diameter):
    project_document["elements"][0]["spec"]["innerDiameter"] = inner_diameter
    result = client.post(VALIDATE_URL, json=project_document).json()
    assert result["valid"] is False
    assert result["issues"][0]["code"] == "INVALID_SPEC"


def test_reducer_outlet_spec_is_validated(client, project_document):
    project_document["elements"][4]["outletSpec"]["innerDiameter"] = 0.018
    result = client.post(VALIDATE_URL, json=project_document).json()
    assert result["valid"] is False
    assert result["issues"][0]["code"] == "INVALID_SPEC"
    assert result["issues"][0]["elementIds"] == ["reducer-1"]


@pytest.mark.parametrize(("length", "valid"), [(0, False), (0.000999, False), (0.001, True)])
def test_pipe_length_threshold(client, project_document, length, valid):
    project_document["elements"][0]["end"]["x"] = length
    result = client.post(VALIDATE_URL, json=project_document).json()
    assert result["valid"] is valid


@pytest.mark.parametrize(("delta", "valid"), [(0.5e-6, True), (1.1e-6, False)])
def test_spec_tolerance(client, project_document, delta, valid):
    project_document["elements"][0]["spec"]["innerDiameter"] += delta
    assert client.post(VALIDATE_URL, json=project_document).json()["valid"] is valid


def test_warning_does_not_invalidate_project(client, project_document):
    reducer = project_document["elements"][4]
    reducer["outletSpec"] = deepcopy(reducer["spec"])
    result = client.post(VALIDATE_URL, json=project_document).json()
    assert result["valid"] is True
    assert result["issues"] == [
        {
            "severity": "warning",
            "code": "REDUCER_SAME_DN",
            "message": '"reducer-1" tem o mesmo diâmetro nominal nas duas extremidades.',
            "elementIds": ["reducer-1"],
        }
    ]


def test_empty_project_is_valid(client, project_document):
    project_document["elements"] = []
    project_document["connections"] = []
    assert client.post(VALIDATE_URL, json=project_document).json() == {
        "valid": True,
        "elementCount": 0,
        "connectionCount": 0,
        "issues": [],
    }


def test_validation_does_not_mutate_project(project_document):
    project = Project.model_validate(project_document)
    original = project.model_dump(by_alias=True)
    assert validate_project(project) == []
    assert project.model_dump(by_alias=True) == original


def test_reports_view_problems(project_document):
    """Esquema v15: vista duplicada e planta de nível inexistente."""
    view = {
        "id": "vista-1",
        "kind": "plan",
        "name": "Planta",
        "visibility": {"hiddenSystemIds": [], "hiddenCategories": [], "details": True},
        "scale": 50,
        "style": {"theme": "color", "thinLines": True},
        "crop": None,
        "frame": None,
        "details": [],
        "levelId": "nivel-inexistente",
        "cutHeight": 3,
        "depth": 3.3,
        "archCutHeight": 1.2,
        "rotation": 0,
    }
    project_document["views"] = [view, deepcopy(view)]
    codes = [issue.code for issue in validate_project(Project.model_validate(project_document))]
    assert codes.count("DANGLING_VIEW_LEVEL") == 2
    assert codes.count("DUPLICATE_VIEW") == 1


ARCH_CASES = [
    "ARCH_DUPLICATE_TYPE",
    "ARCH_SOURCE_REQUIRED",
    "ARCH_DUPLICATE_ID",
    "DUPLICATE_ID",
    "ARCH_TYPE_NOT_FOUND",
    "ARCH_TYPE_MISMATCH",
    "LEVEL_NOT_FOUND:wall",
    "LEVEL_NOT_FOUND:slab",
    "LEVEL_NOT_FOUND:flooring",
    "LEVEL_NOT_FOUND:space",
    "HOST_NOT_FOUND:missing",
    "HOST_NOT_FOUND:not-a-wall",
    "WALL_TOO_SHORT",
]


@pytest.mark.parametrize("case", ARCH_CASES)
def test_each_architecture_referential_error(client, arch_document, case):
    """Esquema v16: mesmos códigos de `archIntegrityProblem` (core/architecture/ops.ts)."""
    code, _, variant = case.partition(":")
    architecture = arch_document["architecture"]
    types = architecture["types"]
    by_id = {element["id"]: element for element in architecture["elements"]}
    if code == "ARCH_DUPLICATE_TYPE":
        types.append(deepcopy(types[0]))
        expected_ids = []
    elif code == "ARCH_SOURCE_REQUIRED":
        types[3]["generic"] = False
        expected_ids = []
    elif code == "ARCH_DUPLICATE_ID":
        architecture["elements"].append(deepcopy(by_id["space-1"]))
        expected_ids = ["space-1"]
    elif code == "DUPLICATE_ID":
        # O identificador é único no projeto inteiro: não pode repetir o de um tubo.
        by_id["space-1"]["id"] = "pipe-1"
        expected_ids = ["pipe-1"]
    elif code == "ARCH_TYPE_NOT_FOUND":
        by_id["door-1"]["typeId"] = "missing"
        expected_ids = ["door-1"]
    elif code == "ARCH_TYPE_MISMATCH":
        by_id["slab-1"]["typeId"] = "type-flooring"
        expected_ids = ["slab-1"]
    elif code == "LEVEL_NOT_FOUND":
        target = f"{variant}-1"
        by_id[target]["levelId"] = "missing"
        expected_ids = [target]
    elif code == "HOST_NOT_FOUND":
        by_id["window-1"]["hostId"] = "missing" if variant == "missing" else "slab-1"
        expected_ids = ["window-1"]
    else:
        by_id["wall-1"]["end"] = {"x": 0.049, "y": 0}
        expected_ids = ["wall-1"]
    response = client.post(VALIDATE_URL, json=arch_document)
    assert response.status_code == 200
    result = response.json()
    assert result["valid"] is False
    assert [(issue["code"], issue["elementIds"]) for issue in result["issues"]] == [
        (code, expected_ids)
    ]
    assert result["issues"][0]["severity"] == "error"
    assert result["issues"][0]["message"]


def test_type_mismatch_message_names_the_category(arch_document):
    arch_document["architecture"]["elements"][3]["typeId"] = "type-flooring"
    issues = validate_project(Project.model_validate(arch_document))
    assert [issue.message for issue in issues] == [
        'O tipo "Porcelanato sobre contrapiso" não é de laje.'
    ]


def test_non_generic_type_with_source_and_wall_at_minimum_length_are_valid(arch_document):
    architecture = arch_document["architecture"]
    architecture["types"][3].update(generic=False, source="Fabricante X, catálogo 2026, p. 12")
    architecture["elements"][0]["end"] = {"x": 0.05, "y": 0}
    assert validate_project(Project.model_validate(arch_document)) == []


def test_architecture_validation_does_not_mutate_project(arch_document):
    project = Project.model_validate(arch_document)
    original = project.model_dump(by_alias=True)
    assert validate_project(project) == []
    assert project.model_dump(by_alias=True) == original
