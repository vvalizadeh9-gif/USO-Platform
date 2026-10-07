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
from app.models.acceptance_plan import AcceptanceMonthlyTarget
from app.models.acceptance_workflow import (
    AcceptanceAuthorityRequest,
    AcceptanceEvidence,
    AcceptanceSubmission,
    AcceptanceSubmissionTech,
)
from app.models.action_center import ActionDailySnapshot, ActionQueueSla, DigestLog
from app.models.auth import LoginAttempt, PasswordResetRequest, SpentCaptcha
from app.models.health_check import (
    HcAssignment,
    HcRemediation,
    HcTask,
    HcTaskTechnology,
)
from app.models.kpi import ProvinceMapping
from app.models.mojri import MojriImportRun, MojriTrackerStatus
from app.models.performance import LifecycleStatusHistory
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
    "AcceptanceAuthorityRequest",
    "ActionDailySnapshot",
    "ActionQueueSla",
    "DigestLog",
    "AcceptanceMonthlyTarget",
    "AcceptanceEvidence",
    "AcceptanceSubmission",
    "AcceptanceSubmissionTech",
    "AuditLog",
    "CpmChangeRequest",
    "CpmImportBatch",
    "Letter",
    "LifecycleStatusHistory",
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
    "MojriImportRun",
    "MojriTrackerStatus",
    "ProvinceMapping",
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
