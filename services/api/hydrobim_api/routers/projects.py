"""Validação de documentos de projeto sem persistência."""

import logging

from fastapi import APIRouter

from hydrobim_api.models.project import CamelModel, Project
from hydrobim_api.services.validation import ValidationIssue, validate_project

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/projects", tags=["projects"])


class ValidationResult(CamelModel):
    valid: bool
    element_count: int
    connection_count: int
    issues: list[ValidationIssue]


@router.post("/validate", response_model=ValidationResult, response_model_by_alias=True)
def validate(project: Project) -> ValidationResult:
    issues = validate_project(project)
    logger.info(
        "project_validation_completed",
        extra={
            "element_count": len(project.elements),
            "connection_count": len(project.connections),
            "issue_count": len(issues),
        },
    )
    return ValidationResult(
        valid=not any(issue.severity == "error" for issue in issues),
        element_count=len(project.elements),
        connection_count=len(project.connections),
        issues=issues,
    )
