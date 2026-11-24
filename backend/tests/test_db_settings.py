"""Database settings from parts (UEP-23).

IT hands out a database as host, port, name, user and password. The URL is
built from those by SQLAlchemy, so a password containing ``@ : / % #`` works
-- pasted into a URL by hand, each of those characters breaks it.
"""
import configparser
import logging

import pytest
from sqlalchemy.engine import make_url

from app.core.config import DEVELOPMENT_DATABASE_URL, DatabaseSettings, Settings

NASTY_PASSWORD = "p@ss:w/rd%41#frag"

PARTS = dict(
    _env_file=None,
    database_url=None,
    db_host="t3vl1177.example.internal",
    db_port=5444,
    db_name="uep_prd",
    db_user="uep_app_svc",
    db_password=NASTY_PASSWORD,
)

GOOD_APP = dict(
    jwt_secret_key="x" * 40,
    first_admin_password="A-strong-first-admin-passw0rd",
    cors_origins="https://uep.example.com",
)


def test_url_from_parts_keeps_every_special_character_in_the_password():
    url = DatabaseSettings(**PARTS).sqlalchemy_url
    assert url.drivername == "postgresql+psycopg"
    assert (url.host, url.port, url.database, url.username) == (
        "t3vl1177.example.internal", 5444, "uep_prd", "uep_app_svc",
    )
    assert url.password == NASTY_PASSWORD
    # The rendered string parses back to the same password.
    rendered = url.render_as_string(hide_password=False)
    assert make_url(rendered).password == NASTY_PASSWORD
    assert url.query["sslmode"] == "prefer"
    assert url.query["connect_timeout"] == "10"


def test_the_alembic_escaping_survives_configparser_interpolation():
    """alembic/env.py doubles every % before handing the URL to configparser."""
    url = DatabaseSettings(**PARTS).sqlalchemy_url
    stored = url.render_as_string(hide_password=False).replace("%", "%%")
    parser = configparser.ConfigParser()
    parser["alembic"] = {"sqlalchemy.url": stored}
    assert make_url(parser["alembic"]["sqlalchemy.url"]).password == NASTY_PASSWORD


def test_database_url_wins_over_parts():
    settings = DatabaseSettings(**{**PARTS, "database_url": "postgresql+psycopg://a:b@db:5432/uep"})
    assert settings.sqlalchemy_url.host == "db"
    assert settings.missing_database_settings() == []


def test_missing_parts_are_named_in_production():
    with pytest.raises(ValueError) as excinfo:
        Settings(_env_file=None, app_env="production", database_url=None,
                 db_host="somewhere", **GOOD_APP)
    message = str(excinfo.value)
    assert "DB_NAME, DB_USER, DB_PASSWORD are not set" in message
    assert "DB_HOST" not in message.split("are not set")[0]


def test_no_database_setting_at_all_stops_production(monkeypatch):
    for name in ("DATABASE_URL", "DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"):
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(ValueError, match="DB_HOST, DB_NAME, DB_USER, DB_PASSWORD are not set"):
        Settings(_env_file=None, app_env="production", **GOOD_APP)


def test_partial_parts_stop_development_too():
    with pytest.raises(ValueError, match="DB_PASSWORD is not set"):
        Settings(_env_file=None, app_env="development", database_url=None,
                 db_host="h", db_name="n", db_user="u")


def test_development_with_nothing_set_uses_the_compose_database(monkeypatch):
    for name in ("DATABASE_URL", "DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"):
        monkeypatch.delenv(name, raising=False)
    settings = Settings(_env_file=None, app_env="development")
    assert settings.sqlalchemy_url == make_url(DEVELOPMENT_DATABASE_URL)


def test_the_password_never_appears_in_repr_or_description(caplog):
    settings = Settings(app_env="production", **PARTS, **GOOD_APP)
    assert NASTY_PASSWORD not in repr(settings)
    assert NASTY_PASSWORD not in str(settings)
    assert settings.database_description() == "uep_app_svc@t3vl1177.example.internal:5444/uep_prd"
    # SQLAlchemy masks the password when a URL is printed or logged.
    caplog.set_level(logging.INFO)
    logging.getLogger("test").info("connecting to %s", settings.sqlalchemy_url)
    assert NASTY_PASSWORD not in caplog.text

    url_settings = Settings(_env_file=None, app_env="production",
                            database_url=f"postgresql+psycopg://u:{'secretpw'}@h/d", **GOOD_APP)
    assert "secretpw" not in repr(url_settings)
