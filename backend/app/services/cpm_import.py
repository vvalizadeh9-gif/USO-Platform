"""CPM import service.

Two modes, one entry point:

* **First import (seed)** — the database has no work items yet. We create
  everything including the AV..BQ execution history (DT, acceptance).
* **Monthly import** — we only diff the A..AT master block. Any of the three
  tracked changes (site type, village quantity, requested technology) on an
  *existing* site becomes a ``CpmChangeRequest`` for PM validation and is NOT
  applied until accepted; every other master field auto-applies silently. The
  DT block (AV..AZ) is seeded once and then app-owned, but the ICT/CRA
  acceptance columns are re-applied on every import (blank cells are ignored)
  so approvals can be maintained through the CPM file.

Only villages classified exactly هدف are imported. Every other value of the
هدف/اقماری column — all اقماری variants plus "هدف (Verbally)" and
"هدف (Removed Verbally)" — is skipped entirely and never enters the DB; those
rows are only counted (``batch.skipped_satellite``). See
``cpm_columns.is_pure_target``.

Performance
-----------
The importer is built for large files (15k+ rows). It does **not** query or
flush per row. Instead it preloads existing sites / work items / villages /
reference data into in-memory caches with a handful of bulk queries, builds
the new object graph through SQLAlchemy relationships, and flushes once at the
end. This turns tens of thousands of round-trips into a small constant number,
so a full monthly file imports in seconds rather than minutes.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import pandas as pd
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.models.acceptance import Acceptance, CpmChangeRequest, CpmImportBatch
from app.models.reference import Contractor, Province, Region
from app.models.workitem import Site, Village, WorkItem
from app.services import cpm_columns as C
from app.services.audit import record_audit


class CpmImportService:
    """Encapsulates CPM Excel ingestion. Bulk-cached, single-flush."""

    def __init__(self, db: Session, user_id: int | None) -> None:
        self._db = db
        self._user_id = user_id
        self._seed_mode = False

        # ---- reference-data caches (loaded once) ----
        self._province_cache: dict[str, Province] = {}
        self._region_cache: dict[str, Region] = {}
        self._contractor_cache: dict[str, Contractor] = {}

        # ---- domain caches (loaded once, updated as we create) ----
        # site_code -> Site
        self._sites: dict[str, Site] = {}
        # (site_code, site_type) -> WorkItem
        self._work_items: dict[tuple[str, str], WorkItem] = {}
        # (site_code, site_type) -> {village_code -> Village}
        self._villages: dict[tuple[str, str], dict[str | None, Village]] = {}

        # Per-import bookkeeping for per-work-item counting.
        self._created_wi_keys: set[tuple[str, str]] = set()
        self._seen_existing_wi_keys: set[tuple[str, str]] = set()
        self._changed_wi_keys: set[tuple[str, str]] = set()
        # Village codes seen this import per work item key (for removed-village
        # detection on re-import).
        self._seen_village_codes: dict[tuple[str, str], set] = {}

        # Accumulated change info, finalised into CpmChangeRequests at the end.
        # requested-tech: wi_key -> (WorkItem, old, new)
        self._tech_changes: dict[tuple[str, str], tuple] = {}
        # site-type: (site_code, new_type) -> dict(site, new_type, fields, existing_types)
        self._site_type_changes: dict[tuple[str, str], dict] = {}
        # village-qty: wi_key -> {"added":[data...], "removed":[codes...]}
        self._village_changes: dict[tuple[str, str], dict] = {}

        # Pending change requests already in the DB (avoid duplicate flags).
        self._pending_tech: set[int] = set()          # work_item_id
        self._pending_village: set[int] = set()        # work_item_id
        self._pending_site_type: set[tuple[str, str]] = set()  # (site_code, new_type)

        # Running counters.
        self._skipped = 0        # rows skipped for not being exactly هدف
        self._new_villages = 0   # village rows created this import

    # ---- public API ----
    def import_file(self, path: str, filename: str) -> CpmImportBatch:
        df = pd.read_excel(path, sheet_name=C.SHEET_NAME, header=C.HEADER_ROW)
        rows = df.values.tolist()

        is_first_import = self._db.query(WorkItem.id).first() is None
        self._seed_mode = is_first_import

        batch = CpmImportBatch(filename=filename, imported_by=self._user_id)
        self._db.add(batch)
        self._db.flush()  # need batch.id for change requests

        self._load_reference_caches()
        if not is_first_import:
            self._load_domain_caches()
            self._load_pending_flags()

        for raw in rows:
            self._process_row(raw, seed=is_first_import)

        # Re-import post-processing: detect removed villages, then materialise
        # every accumulated change into CpmChangeRequests.
        if not is_first_import:
            self._detect_removed_villages()
            self._finalize_change_requests(batch)

        # ---- counters ----
        batch.total_rows = len(rows)
        batch.new_count = len(self._created_wi_keys)
        batch.unchanged_count = len(
            self._seen_existing_wi_keys - self._changed_wi_keys
        )
        batch.changed_village_qty = len(self._village_changes)
        batch.changed_site_type = len(self._site_type_changes)
        batch.changed_requested_tech = len(self._tech_changes)
        batch.changed_count = (
            batch.changed_village_qty
            + batch.changed_site_type
            + batch.changed_requested_tech
        )
        batch.new_villages_count = self._new_villages
        batch.skipped_satellite = self._skipped

        record_audit(
            self._db,
            user_id=self._user_id,
            module="CPM",
            entity_type="CpmImportBatch",
            entity_id=batch.id,
            new_value={"filename": filename, "rows": len(rows)},
            reason="CPM import",
        )
        self._db.commit()
        self._db.refresh(batch)
        return batch

    # ---- cache loading ----
    def _load_reference_caches(self) -> None:
        for prov in self._db.query(Province).all():
            key = C.normalize_persian(prov.name)
            if key:
                self._province_cache[key] = prov
        for reg in self._db.query(Region).all():
            self._region_cache[reg.name] = reg
        for con in self._db.query(Contractor).all():
            self._contractor_cache[" ".join(con.name.split()).lower()] = con

    def _load_domain_caches(self) -> None:
        """Bulk-load existing sites, work items and villages for re-imports."""
        sites = self._db.query(Site).all()
        for site in sites:
            self._sites[site.site_code] = site

        work_items = (
            self._db.query(WorkItem)
            .options(
                selectinload(WorkItem.site),
                # Acceptances too: re-imports now re-apply the per-tech ICT/CRA
                # columns onto existing villages, so we need the rows in hand.
                selectinload(WorkItem.villages).selectinload(Village.acceptances),
            )
            .all()
        )
        for wi in work_items:
            if wi.site is None:
                continue
            key = (wi.site.site_code, wi.site_type)
            self._work_items[key] = wi
            self._villages[key] = {v.village_code: v for v in wi.villages}

    def _load_pending_flags(self) -> None:
        pend = (
            self._db.query(CpmChangeRequest)
            .filter(CpmChangeRequest.status == "Pending")
            .all()
        )
        for cr in pend:
            if cr.change_type == "requested_tech" and cr.work_item_id is not None:
                self._pending_tech.add(cr.work_item_id)
            elif cr.change_type == "village_qty" and cr.work_item_id is not None:
                self._pending_village.add(cr.work_item_id)
            elif cr.change_type == "site_type" and cr.new_value is not None:
                self._pending_site_type.add((cr.site_code, cr.new_value))

    # ---- row handling ----
    def _process_row(self, raw: list, *, seed: bool) -> None:
        site_code = C.clean(self._get(raw, C.COL["site_code"]))
        site_type = C.clean(self._get(raw, C.COL["site_type"]))
        if site_code is None or site_type is None:
            return  # unusable row

        if not C.is_pure_target(self._get(raw, C.COL["target_flag"])):
            # Anything that is not exactly هدف — every اقماری variant and the
            # "(Verbally)" / "(Removed Verbally)" هدف sub-flags — is never
            # stored, just counted.
            self._skipped += 1
            return

        site = self._get_or_create_site(raw, site_code)
        wi_key = (site_code, site_type)
        work_item, wi_created, blocked = self._get_or_create_work_item(
            raw, site, site_code, site_type
        )

        if blocked:
            # Site-type change on an existing site: nothing persisted for this
            # (site, type) until an admin accepts. Skip village handling.
            return

        if wi_created:
            self._created_wi_keys.add(wi_key)
        elif wi_key not in self._created_wi_keys:
            # An existing (pre-import) work item — a later row for the same
            # (site, type) created this run must NOT be counted as existing.
            self._seen_existing_wi_keys.add(wi_key)

        self._handle_village(raw, work_item, wi_key, seed=seed)

    def _get_or_create_site(self, raw: list, site_code: str) -> Site:
        site = self._sites.get(site_code)
        if site is not None:
            return site
        site = Site(
            site_code=site_code,
            temp_site_code=C.clean(self._get(raw, C.COL["temp_site_code"])),
            province_id=self._province_id(self._get(raw, C.COL["province"])),
            region_id=self._region_id(self._get(raw, C.COL["region"])),
            county=C.clean(self._get(raw, C.COL["county"])),
            district=C.clean(self._get(raw, C.COL["district"])),
            rural_district=C.clean(self._get(raw, C.COL["rural_district"])),
            latitude=self._num(self._get(raw, C.COL["site_lat"])),
            longitude=self._num(self._get(raw, C.COL["site_lng"])),
        )
        self._db.add(site)
        self._sites[site_code] = site
        return site

    def _get_or_create_work_item(
        self, raw: list, site: Site, site_code: str, site_type: str
    ) -> tuple[WorkItem, bool, bool]:
        """Return (work_item, created, blocked)."""
        wi_key = (site_code, site_type)
        wi = self._work_items.get(wi_key)
        incoming = self._master_fields(raw)

        if wi is not None:
            if not self._seed_mode:
                self._detect_requested_tech_change(wi, wi_key, incoming)
                self._apply_non_tracked_fields(wi, incoming)
            return wi, False, False

        # No work item for this (site, type). On a re-import, if the SITE
        # already existed with OTHER types, a new type here is a tracked
        # site-type change — block it (don't create yet).
        site_pre_existing = not self._seed_mode and any(
            k[0] == site_code for k in self._work_items
        )
        if site_pre_existing:
            self._accumulate_site_type_change(site, site_code, site_type, incoming)
            # Return a transient (uncommitted) work item so callers have a
            # non-None object; it is NOT added to the session/cache and is
            # deliberately NOT linked to the site relationship (which would
            # otherwise emit a cascade warning on commit). Callers treat
            # blocked=True as "skip", so its fields are never read.
            transient = WorkItem(site_type=site_type)
            return transient, False, True

        # Brand-new work item — create it.
        wi = WorkItem(site=site, site_type=site_type, **incoming)
        if self._seed_mode:
            self._apply_dt_seed(wi, raw)
        self._db.add(wi)
        self._work_items[wi_key] = wi
        self._villages[wi_key] = {}
        return wi, True, False

    def _handle_village(
        self, raw: list, wi: WorkItem, wi_key: tuple[str, str], *, seed: bool
    ) -> None:
        code = C.clean(self._get(raw, C.COL["village_code"]))
        self._seen_village_codes.setdefault(wi_key, set()).add(code)
        existing = self._villages.setdefault(wi_key, {})

        village = existing.get(code)
        if village is not None:
            # Only pure هدف rows get this far, so this refresh exists for one
            # case: a village stored by an older, laxer import (e.g. as
            # "هدف (Verbally)") that the current file promotes to plain هدف —
            # writing it back makes the row visible to the Acceptance KPIs.
            # A village that moves the other way never reaches here at all; its
            # row is skipped, so _detect_removed_villages raises it as a
            # village-quantity change request for PM validation.
            village.target_classification = C.clean(
                self._get(raw, C.COL["target_flag"])
            )
            # ICT/CRA approval columns are re-applied on every import (not just
            # first seed) so coordinators can update approvals via the CPM file.
            self._apply_acceptance(raw, village)
            return

        if seed or wi_key in self._created_wi_keys:
            # First import, or a village on a brand-new work item created this
            # run: add it silently.
            village = self._create_village(raw, wi, code)
            existing[code] = village
            self._new_villages += 1
            self._apply_acceptance(raw, village)
        else:
            # New village on an EXISTING work item during a re-import: tracked
            # change (blocked). Accumulate; do NOT add.
            self._accumulate_village_change(
                wi_key,
                added=self._village_data(raw, code),
                removed=None,
            )

    # ---- change detection / accumulation ----
    def _detect_requested_tech_change(
        self, wi: WorkItem, wi_key: tuple[str, str], incoming: dict
    ) -> None:
        old = wi.requested_technology
        new = incoming.get("requested_technology")
        if (old or None) == (new or None):
            return
        if wi.id in self._pending_tech or wi_key in self._tech_changes:
            self._changed_wi_keys.add(wi_key)
            return
        self._tech_changes[wi_key] = (wi, old, new)
        self._changed_wi_keys.add(wi_key)

    def _accumulate_site_type_change(
        self, site: Site, site_code: str, site_type: str, incoming: dict
    ) -> None:
        key = (site_code, site_type)
        if key in self._pending_site_type or key in self._site_type_changes:
            return
        existing_types = sorted(
            {k[1] for k in self._work_items if k[0] == site_code}
        )
        self._site_type_changes[key] = {
            "site": site,
            "new_type": site_type,
            "fields": incoming,
            "existing_types": existing_types,
        }

    def _accumulate_village_change(
        self, wi_key: tuple[str, str], *, added: dict | None, removed: str | None
    ) -> None:
        bucket = self._village_changes.setdefault(
            wi_key, {"added": [], "removed": []}
        )
        if added is not None:
            bucket["added"].append(added)
        if removed is not None:
            bucket["removed"].append(removed)
        self._changed_wi_keys.add(wi_key)

    def _detect_removed_villages(self) -> None:
        """Flag villages present in the DB but absent from this import file."""
        for wi_key, existing in self._villages.items():
            if wi_key in self._created_wi_keys:
                continue  # brand-new this run — nothing to remove
            if wi_key not in self._seen_village_codes:
                continue  # work item not touched this import — leave alone
            seen = self._seen_village_codes[wi_key]
            for code, village in existing.items():
                if code not in seen:
                    self._accumulate_village_change(
                        wi_key, added=None, removed=code
                    )

    def _finalize_change_requests(self, batch: CpmImportBatch) -> None:
        """Materialise accumulated changes into CpmChangeRequest rows."""
        for wi_key, (wi, old, new) in self._tech_changes.items():
            batch.change_requests.append(
                CpmChangeRequest(
                    import_batch_id=batch.id,
                    work_item_id=wi.id,
                    site_code=wi_key[0],
                    change_type="requested_tech",
                    field_name="requested_technology",
                    old_value=str(old) if old is not None else None,
                    new_value=str(new) if new is not None else None,
                    detail=f"Requested technology change: {old or '—'} → {new or '—'}",
                )
            )

        for (site_code, new_type), data in self._site_type_changes.items():
            existing_types = data["existing_types"]
            batch.change_requests.append(
                CpmChangeRequest(
                    import_batch_id=batch.id,
                    work_item_id=None,
                    site_code=site_code,
                    change_type="site_type",
                    field_name="site_type",
                    old_value=", ".join(existing_types) if existing_types else None,
                    new_value=new_type,
                    detail=f"New site type '{new_type}' on existing site {site_code}",
                    payload_json=json.dumps(
                        {
                            "site_id": data["site"].id,
                            "site_type": new_type,
                            "fields": data["fields"],
                        }
                    ),
                )
            )

        for wi_key, bucket in self._village_changes.items():
            wi = self._work_items.get(wi_key)
            if wi is None:
                continue
            added = bucket["added"]
            removed = bucket["removed"]
            parts = []
            if added:
                parts.append(
                    "villages added: " + ", ".join(v["village_code"] or "?" for v in added)
                )
            if removed:
                parts.append("villages removed: " + ", ".join(c or "?" for c in removed))
            detail = "Village quantity change — " + "; ".join(parts)
            batch.change_requests.append(
                CpmChangeRequest(
                    import_batch_id=batch.id,
                    work_item_id=wi.id,
                    site_code=wi_key[0],
                    change_type="village_qty",
                    field_name="villages",
                    old_value=str(len(self._villages.get(wi_key, {}))),
                    new_value=None,
                    detail=detail,
                    payload_json=json.dumps({"added": added, "removed": removed}),
                )
            )

    # ---- field extraction / helpers ----
    def _master_fields(self, raw: list) -> dict:
        """Extract the A..AT master fields we persist on the work item."""
        return {
            "requested_technology": C.clean(self._get(raw, C.COL["requested_tech"])),
            "deployed_technology": C.clean(self._get(raw, C.COL["deployed_tech"])),
            "project_name": C.clean(self._get(raw, C.COL["project_name"])),
            "overall_project": C.clean(self._get(raw, C.COL["overall_project"])),
            "pm_name": C.clean(self._get(raw, C.COL["pm_name"])),
            "equipment_type": C.clean(self._get(raw, C.COL["equipment_type"])),
            "operator": C.clean(self._get(raw, C.COL["operator"])),
            "power_status": C.clean(self._get(raw, C.COL["power_status"])),
            "monthly_plan": C.clean(self._get(raw, C.COL["monthly_plan"])),
            "last_stage": C.normalize_stage(self._get(raw, C.COL["last_stage"])),
            "referral_letter_number": C.clean(self._get(raw, C.COL["referral_letter"])),
            "referral_date_shamsi": C.clean(self._get(raw, C.COL["referral_date_shamsi"])),
            "launch_date_shamsi": C.clean(self._get(raw, C.COL["launch_date_shamsi"])),
        }

    _NON_TRACKED_FIELDS = (
        "deployed_technology",
        "project_name",
        "overall_project",
        "pm_name",
        "equipment_type",
        "operator",
        "power_status",
        "monthly_plan",
        "last_stage",
        "referral_letter_number",
        "referral_date_shamsi",
        "launch_date_shamsi",
    )

    def _apply_non_tracked_fields(self, wi: WorkItem, incoming: dict) -> None:
        for attr in self._NON_TRACKED_FIELDS:
            if attr in incoming:
                setattr(wi, attr, incoming.get(attr))

    def _apply_dt_seed(self, wi: WorkItem, raw: list) -> None:
        """Populate app-owned Drive Test fields from CPM cols AV..AZ (once)."""
        wi.dt_status = C.normalize_dt_status(self._get(raw, C.COL_HISTORY["dt_status"]))
        wi.dt_problem_category = C.clean(
            self._get(raw, C.COL_HISTORY["dt_problem_category"])
        )
        wi.dt_date_gregorian = self._date(self._get(raw, C.COL_HISTORY["dt_date"]))
        dt_sc = C.clean(self._get(raw, C.COL_HISTORY["dt_sc"]))
        if dt_sc is not None:
            wi.dt_sc_contractor = self._contractor(dt_sc, kind="drive_test")

    def _village_data(self, raw: list, code: str | None) -> dict:
        return {
            "village_code": code,
            "village_name": C.clean(self._get(raw, C.COL["village_name"])),
            "target_classification": C.clean(self._get(raw, C.COL["target_flag"])),
            "households": self._int(self._get(raw, C.COL["households"])),
            "population": self._int(self._get(raw, C.COL["population"])),
            "latitude": self._num(self._get(raw, C.COL["village_lat"])),
            "longitude": self._num(self._get(raw, C.COL["village_lng"])),
        }

    def _create_village(self, raw: list, wi: WorkItem, code: str | None) -> Village:
        village = Village(work_item=wi, **self._village_data(raw, code))
        self._db.add(village)
        return village

    def _apply_acceptance(self, raw: list, village: Village) -> None:
        """Apply the per-technology ICT/CRA statuses from the CPM columns.

        Runs on **every** import (not just the first seed) so coordinators can
        update approvals by editing the CPM file and re-uploading. Rules:

        * A blank cell leaves the existing status untouched — a later monthly
          file with an empty acceptance cell never downgrades an approval.
        * A recognised value (see ``_approval``) sets the status.
        * Missing per-tech rows are created (defaulting to Pending) so all three
          technologies are always represented.
        """
        by_tech = {a.technology: a for a in village.acceptances}
        for tech, ict_key, cra_key in (
            ("2G", "ict_2g", "cra_2g"),
            ("3G", "ict_3g", "cra_3g"),
            ("4G", "ict_4g", "cra_4g"),
        ):
            acc = by_tech.get(tech)
            if acc is None:
                acc = Acceptance(
                    technology=tech, ict_status="Pending", cra_status="Pending"
                )
                village.acceptances.append(acc)
                by_tech[tech] = acc

            ict_val = C.clean(self._get(raw, C.COL_HISTORY[ict_key]))
            if ict_val is not None:
                acc.ict_status = self._approval(ict_val, tech)
            cra_val = C.clean(self._get(raw, C.COL_HISTORY[cra_key]))
            if cra_val is not None:
                acc.cra_status = self._approval(cra_val, tech)

    # Values (case-insensitive) that a field team may type to mean approved or
    # rejected. Anything unrecognised falls through to Pending. Kept permissive
    # because these come straight from hand-edited Excel cells.
    _APPROVED_TOKENS = frozenset({
        "approved", "approve", "approval", "accepted", "accept", "ok", "okay",
        "yes", "y", "done", "true", "1", "✓", "✔", "√",
        "تایید", "تأیید", "تاييد", "تایید شده", "تأیید شده", "موافقت", "بله",
    })
    _REJECTED_TOKENS = frozenset({
        "rejected", "reject", "rej", "no", "n", "false", "0", "✗", "x", "×",
        "رد", "مردود", "عدم تایید", "عدم تأیید",
    })

    @classmethod
    def _approval(cls, cell: str | None, tech: str) -> str:
        """Map a raw acceptance cell to Approved | Rejected | Pending.

        Accepts the technology name itself ("2G" in the 2G column) as approved —
        the original CPM convention — plus a broad set of natural English/Persian
        approval and rejection tokens.
        """
        if cell is None:
            return "Pending"
        low = str(cell).strip().lower()
        if low == tech.lower():
            return "Approved"
        if low in cls._APPROVED_TOKENS:
            return "Approved"
        if low in cls._REJECTED_TOKENS:
            return "Rejected"
        return "Pending"

    # ---- lookup helpers (cache-only, no per-row queries) ----
    def _province_id(self, value: object) -> int | None:
        """Resolve استان to one of the 31 canonical provinces, else None."""
        canonical = C.canonical_province(value)
        if canonical is None:
            return None
        key = C.normalize_persian(canonical)
        prov = self._province_cache.get(key)
        if prov is None:
            # Canonical province missing from DB (should have been seeded);
            # create it so the mapping still works.
            prov = Province(name=canonical)
            self._db.add(prov)
            self._db.flush()
            self._province_cache[key] = prov
        return prov.id

    def _region_id(self, value: object) -> int | None:
        name = C.clean(value)
        if name is None:
            return None
        reg = self._region_cache.get(name)
        if reg is None:
            reg = Region(name=name)
            self._db.add(reg)
            self._region_cache[name] = reg
            self._db.flush()  # rare (bounded by distinct region count)
        return reg.id

    def _contractor_id(self, name: str, kind: str = "drive_test") -> int:
        """Resolve (or create) a contractor and return its id.

        Convenience wrapper used outside the bulk import path; ensures the
        reference cache is warm, then flushes so the id is available.
        """
        if not self._contractor_cache:
            self._load_reference_caches()
        con = self._contractor(name, kind)
        self._db.flush()
        return con.id

    def _contractor(self, name: str, kind: str = "drive_test") -> Contractor:
        """Case-insensitive, whitespace-normalised contractor lookup/creation."""
        normalized_key = " ".join(name.split()).lower()
        con = self._contractor_cache.get(normalized_key)
        if con is None:
            con = Contractor(name=" ".join(name.split()), type=kind, active=True)
            self._db.add(con)
            self._contractor_cache[normalized_key] = con
        return con

    # ---- primitive coercion ----
    @staticmethod
    def _get(raw: list, idx: int) -> object:
        return raw[idx] if idx < len(raw) else None

    @staticmethod
    def _num(value: object) -> float | None:
        text = C.clean(value)
        try:
            return float(text) if text is not None else None
        except ValueError:
            return None

    @staticmethod
    def _int(value: object) -> int | None:
        num = CpmImportService._num(value)
        return int(num) if num is not None else None

    @staticmethod
    def _date(value: object):
        if value is None:
            return None
        if hasattr(value, "date") and not isinstance(value, str):
            try:
                return value.date()
            except Exception:
                return None
        text = C.clean(value)
        if text is None:
            return None
        from datetime import datetime as _dt

        for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d-%m-%Y", "%m/%d/%Y"):
            try:
                return _dt.strptime(text[:10], fmt).date()
            except ValueError:
                continue
        return None
