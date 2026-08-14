"""Shared test helpers.

Sample-CPM resolution: prefer the small purpose-built ``CPM_2_.xlsx`` fixture
when present, otherwise fall back to the real ``CPM-Org_-_Copy.xlsx`` upload so
the suite still runs end-to-end against genuine data in environments where the
small fixture isn't checked in.
"""
import os

_SAMPLE_CANDIDATES = (
    "/mnt/user-data/uploads/CPM_2_.xlsx",
    "/mnt/user-data/uploads/CPM-Org_-_Copy.xlsx",
)


def sample_cpm_path() -> str | None:
    for path in _SAMPLE_CANDIDATES:
        if os.path.exists(path):
            return path
    return None


def login_form(client, username: str = "admin", password: str = "Admin@12345") -> dict:
    """Build a login form payload, solving a fresh captcha challenge first."""
    challenge = client.get("/api/v1/auth/captcha").json()
    return {
        "username": username,
        "password": password,
        "captcha_token": challenge["token"],
        "captcha_answer": challenge["num1"] + challenge["num2"],
    }
