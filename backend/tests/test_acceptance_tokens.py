"""The shared "this cell means yes" rule, and that both importers use it.

``acceptance_tokens`` exists so the CPM and Mojri importers can never disagree
about what a hand-typed cell means. The tech-name convention ("2G" in the 2G
column) once lived only inside the CPM importer, and the Mojri importer read
every such cell as "needs a look" -- the exact drift the module was created to
prevent. These tests hold the rule in one place.

Run with:  cd backend && pytest tests/test_acceptance_tokens.py -q
"""
import os
import sys

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite:////tmp/uep_tokens_pytest.db")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services import acceptance_tokens as tokens  # noqa: E402


@pytest.mark.parametrize(
    "token,tech,expected",
    [
        # The shared vocabulary, with or without a column.
        ("yes", None, True),
        ("Approved", "2G", True),
        ("تایید", "3G", True),
        (1, None, True),
        ("  OK  ", "4G", True),
        # The column's own technology name: the original CPM convention.
        ("2G", "2G", True),
        ("2g", "2G", True),
        (" 4G ", "4G", True),
        # Another technology's name is not a yes.
        ("3G", "2G", False),
        ("2G", "4G", False),
        # Without a column there is no tech-name rule to apply.
        ("2G", None, False),
        # Blank, negative and unrecognised are all not-positive.
        (None, "2G", False),
        ("", "2G", False),
        ("   ", "2G", False),
        ("no", "2G", False),
        ("رد", "2G", False),
        ("?", "2G", False),
        ("2G3G", "2G", False),
    ],
)
def test_is_positive(token, tech, expected):
    assert tokens.is_positive(token, tech) is expected


@pytest.mark.parametrize(
    "cell,tech,expected",
    [
        ("2G", "2G", "Approved"),
        ("3g", "3G", "Approved"),
        ("yes", "4G", "Approved"),
        ("3G", "2G", "Pending"),
        ("no", "2G", "Rejected"),
        (None, "2G", "Pending"),
    ],
)
def test_the_cpm_importer_reads_a_cell_through_the_shared_rule(cell, tech, expected):
    from app.services.cpm_import import CpmImportService

    assert CpmImportService._approval(cell, tech) == expected


def test_the_mojri_importer_reads_a_cell_through_the_shared_rule():
    """Every cell the CPM importer calls Approved, the Mojri importer calls
    in_tracker -- for the same column."""
    from openpyxl import Workbook

    from app.models.mojri import IN_TRACKER
    from app.services import mojri_tracker
    from app.services.cpm_import import CpmImportService

    sheet = Workbook().active
    for tech in mojri_tracker.TEMPLATE_TECHS:
        for value in ("yes", tech, tech.lower(), "تایید"):
            sheet.cell(row=2, column=1, value=value)
            assert CpmImportService._approval(value, tech) == "Approved"
            assert mojri_tracker._read_cell(sheet, 2, 1, tech) == IN_TRACKER, (value, tech)
