"""Every column that points at a stored file is in FILE_REFERENCES (UEP-20).

The cleanup job deletes any stored file no registered column references. A new
upload feature that stores files but is missing from the registry would have
its files deleted -- exactly the bug the old disk-based cleanup had with
drive-test evidence and MTN submission letters. This test fails first.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app.models  # noqa: E402,F401  (register every model)
from app.core.database import Base  # noqa: E402
from app.models.stored_file import StoredFile  # noqa: E402
from app.services.evidence_store import FILE_REFERENCES  # noqa: E402


def _registered() -> set[tuple[str, str]]:
    return {(c.class_.__tablename__, c.key) for c in FILE_REFERENCES}


def test_every_file_pointing_column_is_registered():
    registered_tables = {table for table, _ in _registered()}
    missing = []
    for mapper in Base.registry.mappers:
        model = mapper.class_
        if model is StoredFile:
            continue
        for column in mapper.columns:
            name = column.key
            if name == "stored_path" or name.endswith("sha256"):
                if name == "stored_path":
                    ok = model.__tablename__ in registered_tables
                else:
                    ok = (model.__tablename__, name) in _registered()
                if not ok:
                    missing.append(f"{model.__name__}.{name}")
    assert not missing, (
        "These columns point at stored files but are not in "
        "evidence_store.FILE_REFERENCES, so reclaim_uploads would delete their "
        f"files: {missing}"
    )


def test_the_registry_names_the_known_tables():
    assert _registered() >= {
        ("acceptance_evidence", "sha256"),
        ("drive_test_evidence", "sha256"),
        ("submission_letter_files", "sha256"),
        ("cpm_import_batches", "source_sha256"),
    }
