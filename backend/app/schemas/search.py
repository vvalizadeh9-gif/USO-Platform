"""The shape of the header search's answer."""
from pydantic import BaseModel


class SearchHitOut(BaseModel):
    id: int
    title: str
    subtitle: str
    #: An address inside the app, always starting with "/".
    route: str


class SearchGroupOut(BaseModel):
    key: str
    label: str
    #: Every match, not only the ones returned in ``items``.
    total: int
    items: list[SearchHitOut]


class SearchOut(BaseModel):
    query: str
    groups: list[SearchGroupOut]
