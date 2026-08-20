"""Import all models so SQLAlchemy metadata and Alembic can discover them."""
from app.models.acceptance import (
    Acceptance,
    AuditLog,
    CpmChangeRequest,
    CpmImportBatch,
    Letter,
    MonthlySnapshot,
    Notification,
    letter_villages,
)
from app.models.acceptance_workflow import (
    AcceptanceEvidence,
    AcceptanceSubmission,
    AcceptanceSubmissionTech,
)
from app.models.health_check import HcAssignment, HcTask, HcTaskTechnology
from app.models.reference import (
    Contractor,
    ProblemCategory,
    Province,
    Region,
    Role,
    User,
    user_province_access,
)
from app.models.workitem import (
    Assignment,
    DriveTest,
    HealthCheck,
    Site,
    Village,
    WorkItem,
)

__all__ = [
    "Acceptance",
    "AcceptanceEvidence",
    "AcceptanceSubmission",
    "AcceptanceSubmissionTech",
    "AuditLog",
    "CpmChangeRequest",
    "CpmImportBatch",
    "Letter",
    "MonthlySnapshot",
    "HcAssignment",
    "HcTask",
    "HcTaskTechnology",
    "Notification",
    "letter_villages",
    "Contractor",
    "ProblemCategory",
    "Province",
    "Region",
    "Role",
    "User",
    "user_province_access",
    "Assignment",
    "DriveTest",
    "HealthCheck",
    "Site",
    "Village",
    "WorkItem",
]
