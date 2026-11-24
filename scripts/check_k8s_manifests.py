#!/usr/bin/env python3
"""Check rendered Kubernetes manifests against what prd-uep accepts (UEP-23).

    kubectl kustomize deploy/k8s/ > rendered.yaml
    python scripts/check_k8s_manifests.py rendered.yaml      # or "-" for stdin

The namespace on IT's shared cluster has a ResourceQuota and a LimitRange, and
allows no storage, no Jobs and nothing cluster-wide. A manifest that breaks
one of those rules is refused by the cluster at deploy time, often with a
message that does not say which setting caused it. This finds the same
problems in CI, in plain sentences, before anyone opens Rancher.

It fails (exit 1) if:
  * a forbidden kind or field appears (storage, Jobs, DaemonSets, host access,
    LoadBalancer/NodePort Services, Namespace or any cluster-wide object);
  * an object is not in namespace prd-uep;
  * a container lacks a CPU or memory request or limit, asks for more than
    its limit, or is outside the LimitRange;
  * all replicas, plus one rolling-update surge pod per Deployment, would
    exceed the quota;
  * an emptyDir is not memory-backed, or an image is "latest" or untagged.

The numbers below are the ones IT showed for prd-uep on 22 Nov 2026. If IT
changes the quota, change them here.
"""
from __future__ import annotations

import math
import re
import sys
from dataclasses import dataclass, field
from decimal import Decimal

import yaml

NAMESPACE = "prd-uep"

# LimitRange, per container.
LIMIT_MIN = {"cpu": Decimal("0.1"), "memory": Decimal(128 * 2**20)}
LIMIT_MAX = {"cpu": Decimal("4"), "memory": Decimal(4 * 2**30)}

# ResourceQuota (hard).
QUOTA = {
    "requests.cpu": Decimal("4"),
    "requests.memory": Decimal(8 * 2**30),
    "limits.cpu": Decimal("16"),
    "limits.memory": Decimal(32 * 2**30),
    "requests.ephemeral-storage": Decimal(0),
    "limits.ephemeral-storage": Decimal(0),
    "pods": 100,
}
OBJECT_QUOTA = {
    "Service": 25,
    "ConfigMap": 25,
    "Secret": 60,
    "Deployment": 25,
}

FORBIDDEN_KINDS = {
    "PersistentVolumeClaim": "storage is not allowed in prd-uep (quota 0)",
    "PersistentVolume": "storage is not allowed in prd-uep",
    "StatefulSet": "StatefulSets are not allowed in prd-uep (quota 0)",
    "Job": "Jobs are not allowed in prd-uep (quota 0)",
    "CronJob": "CronJobs are not allowed in prd-uep (quota 0)",
    "DaemonSet": "DaemonSets are not allowed on the shared cluster",
    "Namespace": "the namespace already exists and is IT's; do not create it",
    "ClusterRole": "cluster-wide objects are not allowed",
    "ClusterRoleBinding": "cluster-wide objects are not allowed",
    "CustomResourceDefinition": "cluster-wide objects are not allowed",
    "IngressClass": "cluster-wide objects are not allowed; use IT's Ingress class",
    "StorageClass": "cluster-wide objects are not allowed",
    "PriorityClass": "cluster-wide objects are not allowed",
    "ValidatingWebhookConfiguration": "cluster-wide objects are not allowed",
    "MutatingWebhookConfiguration": "cluster-wide objects are not allowed",
    "APIService": "cluster-wide objects are not allowed",
}

WORKLOAD_KINDS = {"Deployment", "ReplicaSet", "Pod"}

_CPU_SUFFIX = {"m": Decimal("0.001"), "": Decimal(1)}
_MEM_SUFFIX = {
    "Ki": 2**10, "Mi": 2**20, "Gi": 2**30, "Ti": 2**40,
    "k": 10**3, "K": 10**3, "M": 10**6, "G": 10**9, "T": 10**12, "": 1,
}


def parse_quantity(value, kind: str) -> Decimal:
    """A Kubernetes quantity ("250m", "1", "512Mi", "1Gi") as a number.

    CPU in cores, everything else in bytes.
    """
    text = str(value).strip()
    match = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)([a-zA-Z]*)", text)
    if not match:
        raise ValueError(f'"{value}" is not a valid quantity')
    number, suffix = Decimal(match.group(1)), match.group(2)
    table = _CPU_SUFFIX if kind == "cpu" else _MEM_SUFFIX
    if suffix not in table:
        raise ValueError(f'"{value}" has an unknown unit "{suffix}"')
    return number * Decimal(table[suffix])


def show(amount: Decimal, kind: str) -> str:
    if kind == "cpu":
        return f"{amount.normalize():f} CPU"
    gib = amount / Decimal(2**30)
    if gib >= 1:
        return f"{gib.quantize(Decimal('0.01')).normalize():f}Gi"
    return f"{(amount / Decimal(2**20)).quantize(Decimal('1')):f}Mi"


@dataclass
class Report:
    problems: list[str] = field(default_factory=list)

    def fail(self, message: str) -> None:
        self.problems.append(message)


def _pod_spec(doc: dict) -> dict | None:
    kind = doc.get("kind")
    if kind == "Pod":
        return doc.get("spec") or {}
    if kind in WORKLOAD_KINDS | {"StatefulSet", "DaemonSet", "Job"}:
        return ((doc.get("spec") or {}).get("template") or {}).get("spec") or {}
    if kind == "CronJob":
        job = ((doc.get("spec") or {}).get("jobTemplate") or {}).get("spec") or {}
        return (job.get("template") or {}).get("spec") or {}
    return None


def _pods_at_peak(doc: dict) -> int:
    """How many pods this object can have at once, counting a rollout's surge."""
    kind = doc.get("kind")
    if kind == "Pod":
        return 1
    spec = doc.get("spec") or {}
    replicas = int(spec.get("replicas", 1))
    if kind != "Deployment":
        return replicas
    strategy = spec.get("strategy") or {}
    if strategy.get("type") == "Recreate":
        return replicas
    surge = (strategy.get("rollingUpdate") or {}).get("maxSurge", "25%")
    if isinstance(surge, str) and surge.endswith("%"):
        surge = math.ceil(replicas * int(surge[:-1]) / 100)
    # At least one surge pod is assumed, as IT asked: the rollout needs room.
    return replicas + max(int(surge), 1)


def _check_image(where: str, image: str | None, report: Report) -> None:
    if not image:
        report.fail(f"{where}: no image is set.")
        return
    if "@sha256:" in image:
        return
    name_part = image.rsplit("/", 1)[-1]
    if ":" not in name_part:
        report.fail(f'{where}: image "{image}" has no tag, which means "latest". '
                    "Use the short commit tag.")
    elif name_part.rsplit(":", 1)[1] == "latest":
        report.fail(f'{where}: image "{image}" uses the tag "latest". Use the short commit tag.')


def _check_container(where: str, container: dict, report: Report) -> dict[str, Decimal]:
    """Check one container; return its requests/limits for the quota sums."""
    _check_image(where, container.get("image"), report)
    resources = container.get("resources") or {}
    totals: dict[str, Decimal] = {}
    for kind in ("cpu", "memory"):
        values = {}
        for side in ("requests", "limits"):
            raw = (resources.get(side) or {}).get(kind)
            if raw is None:
                report.fail(
                    f"{where}: no {kind} {side[:-1]} is set. Every container must set CPU "
                    "and memory requests and limits, or the LimitRange default "
                    "(cpu 200m / memory 256Mi) is applied."
                )
                continue
            try:
                values[side] = parse_quantity(raw, kind)
            except ValueError as exc:
                report.fail(f"{where}: {kind} {side[:-1]} {exc}.")
                continue
            amount = values[side]
            if amount < LIMIT_MIN[kind]:
                report.fail(f"{where}: {kind} {side[:-1]} {raw} is below the LimitRange "
                            f"minimum of {show(LIMIT_MIN[kind], kind)}.")
            if amount > LIMIT_MAX[kind]:
                report.fail(f"{where}: {kind} {side[:-1]} {raw} is above the LimitRange "
                            f"maximum of {show(LIMIT_MAX[kind], kind)}.")
            totals[f"{side}.{kind}"] = amount
        if "requests" in values and "limits" in values and values["requests"] > values["limits"]:
            report.fail(f"{where}: the {kind} request is larger than its limit; the cluster "
                        "rejects that.")
    for side in ("requests", "limits"):
        raw = (resources.get(side) or {}).get("ephemeral-storage")
        if raw is not None:
            try:
                totals[f"{side}.ephemeral-storage"] = parse_quantity(raw, "memory")
            except ValueError as exc:
                report.fail(f"{where}: ephemeral-storage {side[:-1]} {exc}.")
    return totals


def _check_pod_spec(where: str, spec: dict, report: Report) -> dict[str, Decimal]:
    for flag in ("hostNetwork", "hostPID", "hostIPC"):
        if spec.get(flag):
            report.fail(f"{where}: {flag} is not allowed on the shared cluster.")
    for volume in spec.get("volumes") or []:
        name = volume.get("name", "?")
        if "hostPath" in volume:
            report.fail(f'{where}: volume "{name}" uses hostPath, which is not allowed.')
        if "persistentVolumeClaim" in volume:
            report.fail(f'{where}: volume "{name}" uses a PersistentVolumeClaim; storage is '
                        "not allowed in prd-uep.")
        if "emptyDir" in volume:
            empty_dir = volume.get("emptyDir") or {}
            if empty_dir.get("medium") != "Memory":
                report.fail(f'{where}: emptyDir "{name}" is not memory-backed (medium: Memory). '
                            "A disk-backed emptyDir uses ephemeral storage, whose quota is 0.")
    totals: dict[str, Decimal] = {}
    containers = [("container", c) for c in spec.get("containers") or []]
    containers += [("init container", c) for c in spec.get("initContainers") or []]
    if not containers:
        report.fail(f"{where}: no containers.")
    for label, container in containers:
        part = _check_container(f'{where}, {label} "{container.get("name", "?")}"', container, report)
        for key, amount in part.items():
            totals[key] = totals.get(key, Decimal(0)) + amount
    return totals


def check(documents: list[dict]) -> list[str]:
    report = Report()
    sums: dict[str, Decimal] = {key: Decimal(0) for key in QUOTA if key != "pods"}
    pods = 0
    counts: dict[str, int] = {}

    for doc in documents:
        if not isinstance(doc, dict) or not doc:
            continue
        kind = doc.get("kind", "?")
        name = (doc.get("metadata") or {}).get("name", "?")
        where = f"{kind} {name}"
        counts[kind] = counts.get(kind, 0) + 1

        if kind in FORBIDDEN_KINDS:
            report.fail(f"{where}: {FORBIDDEN_KINDS[kind]}.")
        namespace = (doc.get("metadata") or {}).get("namespace")
        if kind not in FORBIDDEN_KINDS and namespace != NAMESPACE:
            report.fail(f'{where}: namespace is "{namespace}", not "{NAMESPACE}".')
        if kind == "Service":
            service_type = (doc.get("spec") or {}).get("type", "ClusterIP")
            if service_type in ("LoadBalancer", "NodePort"):
                report.fail(f"{where}: Service type {service_type} is not allowed (quota 0). "
                            "Use ClusterIP; users arrive through the Ingress.")

        spec = _pod_spec(doc)
        if spec is None:
            continue
        per_pod = _check_pod_spec(where, spec, report)
        peak = _pods_at_peak(doc)
        pods += peak
        for key, amount in per_pod.items():
            if key in sums:
                sums[key] += amount * peak

    for key, total in sums.items():
        limit = QUOTA[key]
        if total > limit:
            unit = "cpu" if key.endswith("cpu") else "memory"
            report.fail(
                f"Quota: {key} would reach {show(total, unit)} with every replica plus one "
                f"rolling-update pod per Deployment, above the quota of {show(limit, unit)}."
                + (" (prd-uep allows no ephemeral storage; see optional/ephemeral-storage.yaml.)"
                   if "ephemeral" in key else "")
            )
    if pods > QUOTA["pods"]:
        report.fail(f"Quota: up to {pods} pods at once, above the quota of {QUOTA['pods']}.")
    for kind, limit in OBJECT_QUOTA.items():
        if counts.get(kind, 0) > limit:
            report.fail(f"Quota: {counts[kind]} {kind} objects, above the quota of {limit}.")
    return report.problems


def load(path: str) -> list[dict]:
    text = sys.stdin.read() if path == "-" else open(path, encoding="utf-8").read()
    return [doc for doc in yaml.safe_load_all(text) if doc]


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__.split("\n\n")[1], file=sys.stderr)
        return 2
    try:
        documents = load(argv[1])
    except (OSError, yaml.YAMLError) as exc:
        print(f"✘ Could not read {argv[1]}: {exc}")
        return 1
    problems = check(documents)
    if problems:
        print(f"✘ {len(problems)} problem(s) the prd-uep namespace would refuse:")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    print(f"✔ {len(documents)} object(s) checked: nothing prd-uep would refuse.")
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    sys.exit(main(sys.argv))
