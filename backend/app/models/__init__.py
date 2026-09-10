"""Import all models so SQLAlchemy metadata and Alembic can discover them."""
from app.models.acceptance import (
    Acceptance,
    AuditLog,
    CpmChangeRequest,
    CpmImportBatch,
    Letter,
    MonthlySnapshot,
    Notification,
    SnapshotContractorCompletion,
    letter_villages,
)
from app.models.acceptance_workflow import (
    AcceptanceEvidence,
    AcceptanceSubmission,
    AcceptanceSubmissionTech,
)
from app.models.auth import LoginAttempt, PasswordResetRequest, SpentCaptcha
from app.models.health_check import (
    HcAssignment,
    HcRemediation,
    HcTask,
    HcTaskTechnology,
)
from app.models.monthly_plan import ContractorMonthlyPlan
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
    DriveTestEvidence,
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
    "SnapshotContractorCompletion",
    "HcAssignment",
    "HcRemediation",
    "LoginAttempt",
    "PasswordResetRequest",
    "SpentCaptcha",
    "HcTask",
    "HcTaskTechnology",
    "Notification",
    "letter_villages",
    "Contractor",
    "ContractorMonthlyPlan",
    "ProblemCategory",
    "Province",
    "Region",
    "Role",
    "User",
    "user_province_access",
    "Assignment",
    "DriveTest",
    "DriveTestEvidence",
    "HealthCheck",
    "Site",
    "Village",
    "WorkItem",
]
