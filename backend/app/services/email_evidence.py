"""An emailed letter, read for the evidence viewer (UEP-16).

ICT and CRA answers often arrive as an email rather than a scan. The viewer
shows the email's headers, its body as **plain text**, and its attachments.

The email's HTML is never sent to the browser. When a message has only an
HTML body it is converted to text here, so no script, link or remote image in
an email can run or load on the page. Attachments are served as downloads,
except PDFs and images whose bytes prove what they are (see
:func:`attachment_kind`), which the viewer may open.

``.eml`` is parsed with Python's ``email`` package; Outlook ``.msg`` with
``extract-msg`` (pinned in requirements.txt and vendored for the offline
server). A file either cannot parse raises :class:`EmailError`.
"""
from __future__ import annotations

import mimetypes
import re
from dataclasses import dataclass, field
from email import policy
from email.parser import BytesParser
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser

from app.services import evidence_store

#: The body is cut here: the viewer is for reading a letter, not an archive.
MAX_BODY_CHARS = 200_000


class EmailError(ValueError):
    """The file could not be read as an email; the message is safe to show."""


@dataclass
class Attachment:
    index: int
    filename: str
    content_type: str
    size_bytes: int
    kind: str
    data: bytes = field(repr=False, default=b"")


@dataclass
class ParsedEmail:
    sender: str | None
    to: str | None
    cc: str | None
    date: str | None  # ISO 8601 when the header parses, else as written
    subject: str | None
    text_body: str
    attachments: list[Attachment] = field(default_factory=list)


# --------------------------------------------------------------------------
# HTML to text
# --------------------------------------------------------------------------
_BLOCK_TAGS = {"p", "div", "br", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table", "blockquote"}
_SKIP_TAGS = {"script", "style", "head", "title"}


class _TextOnly(HTMLParser):
    """Keeps the text of an HTML body and nothing else: no tag, no attribute,
    no URL survives."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):  # noqa: ARG002 -- attributes are dropped on purpose
        if tag in _SKIP_TAGS:
            self._skip += 1
        elif tag in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in _SKIP_TAGS and self._skip:
            self._skip -= 1
        elif tag in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self._skip:
            self.parts.append(data)


def html_to_text(html: str) -> str:
    parser = _TextOnly()
    parser.feed(html or "")
    parser.close()
    text = "".join(parser.parts).replace("\xa0", " ")
    text = re.sub(r"[ \t]+\n", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _clip(text: str) -> str:
    text = (text or "").replace("\r\n", "\n").strip()
    return text if len(text) <= MAX_BODY_CHARS else text[:MAX_BODY_CHARS] + "\n…"


# --------------------------------------------------------------------------
# Attachments
# --------------------------------------------------------------------------
def attachment_kind(data: bytes) -> str:
    """What an attachment's bytes prove it is -- never its name or its claim."""
    if data.startswith(b"%PDF"):
        return evidence_store.KIND_PDF
    if data.startswith((b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n")) or (
        data.startswith(b"RIFF") and data[8:12] == b"WEBP"
    ):
        return evidence_store.KIND_IMAGE
    return evidence_store.KIND_FILE


_IMAGE_TYPES = {b"\xff\xd8\xff": "image/jpeg", b"\x89PNG": "image/png", b"RIFF": "image/webp"}


def served_type(attachment: Attachment) -> str:
    """The Content-Type an attachment is served as, from its proven kind."""
    if attachment.kind == evidence_store.KIND_PDF:
        return "application/pdf"
    if attachment.kind == evidence_store.KIND_IMAGE:
        for magic, media in _IMAGE_TYPES.items():
            if attachment.data.startswith(magic):
                return media
    return "application/octet-stream"


def _attachment(index: int, filename: str | None, data: bytes) -> Attachment:
    name = evidence_store.safe_filename(filename or f"attachment-{index + 1}")
    return Attachment(
        index=index,
        filename=name,
        content_type=mimetypes.guess_type(name)[0] or "application/octet-stream",
        size_bytes=len(data),
        kind=attachment_kind(data),
        data=data,
    )


# --------------------------------------------------------------------------
# .eml
# --------------------------------------------------------------------------
def _iso_date(raw: str | None) -> str | None:
    if not raw:
        return None
    try:
        return parsedate_to_datetime(str(raw)).isoformat()
    except (TypeError, ValueError, IndexError):
        return str(raw)


def _header(message, name: str) -> str | None:
    value = message.get(name)
    return str(value) if value else None


def parse_eml(content: bytes) -> ParsedEmail:
    try:
        message = BytesParser(policy=policy.default).parsebytes(content)
    except Exception as exc:  # noqa: BLE001 -- any failure is "unreadable"
        raise EmailError("This email could not be read") from exc

    text = None
    html = None
    attachments: list[Attachment] = []
    for part in message.walk():
        if part.is_multipart():
            continue
        disposition = part.get_content_disposition()
        content_type = part.get_content_type()
        if disposition == "attachment" or (disposition == "inline" and part.get_filename()):
            data = part.get_payload(decode=True) or b""
            attachments.append(_attachment(len(attachments), part.get_filename(), data))
        elif content_type == "text/plain" and text is None:
            text = part.get_content()
        elif content_type == "text/html" and html is None:
            html = part.get_content()

    body = text if text and text.strip() else html_to_text(html or "")
    return ParsedEmail(
        sender=_header(message, "From"),
        to=_header(message, "To"),
        cc=_header(message, "Cc"),
        date=_iso_date(message.get("Date")),
        subject=_header(message, "Subject"),
        text_body=_clip(body),
        attachments=attachments,
    )


# --------------------------------------------------------------------------
# .msg
# --------------------------------------------------------------------------
def _decode(value) -> str:
    if isinstance(value, bytes):
        for encoding in ("utf-8", "cp1256", "latin-1"):
            try:
                return value.decode(encoding)
            except UnicodeDecodeError:
                continue
    return str(value or "")


def parse_msg(content: bytes) -> ParsedEmail:
    try:
        import extract_msg  # noqa: PLC0415 -- optional at import time, required here
    except ImportError as exc:  # pragma: no cover -- the server installs it
        raise EmailError("Outlook messages cannot be read on this server") from exc
    try:
        message = extract_msg.openMsg(content)
    except Exception as exc:  # noqa: BLE001 -- any failure is "unreadable"
        raise EmailError("This Outlook message could not be read") from exc
    try:
        attachments = []
        for item in message.attachments:
            data = getattr(item, "data", None)
            if not isinstance(data, bytes):
                continue  # an embedded message or an OLE object: not a file
            name = getattr(item, "longFilename", None) or getattr(item, "shortFilename", None)
            attachments.append(_attachment(len(attachments), name, data))
        text = _decode(message.body)
        if not text.strip():
            text = html_to_text(_decode(getattr(message, "htmlBody", None)))
        date = message.date
        return ParsedEmail(
            sender=message.sender or None,
            to=message.to or None,
            cc=message.cc or None,
            date=date.isoformat() if hasattr(date, "isoformat") else _iso_date(date),
            subject=message.subject or None,
            text_body=_clip(text),
            attachments=attachments,
        )
    finally:
        message.close()


def parse(stored_path: str, content: bytes) -> ParsedEmail:
    """Parse a stored email by the extension its magic bytes were checked as."""
    ext = evidence_store.extension_of(stored_path)
    if ext == "eml":
        return parse_eml(content)
    if ext == "msg":
        return parse_msg(content)
    raise EmailError("This file is not an email")
