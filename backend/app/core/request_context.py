"""The current request's source address, available without passing it around.

``audit_logs.ip_address`` has existed since the table was created. ``record_audit``
has always accepted an ``ip_address`` argument, and the admin API has always
returned the field. No caller ever passed it, so every row in ten years of
accountability trail would have said who did something and never from where.

The reason nobody passed it is structural rather than an oversight: the address
lives on the ``Request``, and the ~30 places that write audit entries are
service functions and endpoint bodies that mostly have no reason to hold one.
Threading a ``Request`` through all of them to reach ``record_audit`` would put
a transport detail into every signature between here and there.

A context variable set once by the middleware avoids that. It is set at the
start of each request and reset at the end, and reading it outside a request --
in a test, or in a startup task -- returns None, which ``record_audit`` already
accepts.
"""
from contextvars import ContextVar

# ContextVar rather than a module global: it is per-task, so concurrent
# requests in the same worker cannot read each other's value.
_client_ip: ContextVar[str | None] = ContextVar("uep_client_ip", default=None)


def set_client_ip(value: str | None):
    """Record the current request's address. Returns a reset token."""
    return _client_ip.set(value)


def reset_client_ip(token) -> None:
    """Restore whatever was set before, so nothing leaks between requests."""
    _client_ip.reset(token)


def current_client_ip() -> str | None:
    """The address of the request being handled, or None outside a request."""
    return _client_ip.get()
