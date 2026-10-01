"""Outgoing mail.

The platform sent no mail before the Action Center's daily digest, and that
digest is still the only sender. Password resets deliberately stay out of
band (see ``Login.jsx``): this module adds a channel, it does not change who
is allowed to use it.

:class:`Mailer` is a protocol so the digest job can be run against a fake in
tests and against SMTP everywhere else.
"""
from __future__ import annotations

import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Protocol

from app.core.config import get_settings

SECURITY_STARTTLS = "starttls"
SECURITY_SSL = "ssl"
SECURITY_NONE = "none"


class MailNotConfigured(RuntimeError):
    """No SMTP host is set, so nothing can be sent."""


@dataclass(frozen=True)
class Message:
    to: str
    subject: str
    text: str
    html: str


class Mailer(Protocol):
    def send(self, message: Message) -> None: ...


class SmtpMailer:
    """Sends through the configured relay, one connection per message.

    A digest run sends at most one message per user, and a fresh connection
    per message means one refused recipient cannot leave the session in a
    state that fails everyone after them.
    """

    def __init__(self) -> None:
        self.settings = get_settings()

    def _connect(self) -> smtplib.SMTP:
        s = self.settings
        if not s.smtp_host:
            raise MailNotConfigured("SMTP_HOST is not set")
        security = s.smtp_security.strip().lower()
        if security == SECURITY_SSL:
            return smtplib.SMTP_SSL(
                s.smtp_host, s.smtp_port, timeout=s.smtp_timeout_seconds,
                context=ssl.create_default_context(),
            )
        client = smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=s.smtp_timeout_seconds)
        if security == SECURITY_STARTTLS:
            client.starttls(context=ssl.create_default_context())
        return client

    def send(self, message: Message) -> None:
        mail = EmailMessage()
        mail["From"] = self.settings.mail_from
        mail["To"] = message.to
        mail["Subject"] = message.subject
        mail.set_content(message.text)
        mail.add_alternative(message.html, subtype="html")
        with self._connect() as client:
            if self.settings.smtp_username:
                client.login(self.settings.smtp_username, self.settings.smtp_password)
            client.send_message(mail)
