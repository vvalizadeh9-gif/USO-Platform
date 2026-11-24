"""scripts/check_k8s_manifests.py: one failing fixture per rule (UEP-23 5.9).

Each test starts from a minimal manifest set that prd-uep accepts, breaks one
rule, and checks the script names it. The last test renders the real
deploy/k8s/ kustomization (when kubectl is available) and checks it passes.
"""
import copy
import importlib.util
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

REPO = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("check_k8s_manifests", REPO / "scripts" / "check_k8s_manifests.py")
checker = importlib.util.module_from_spec(_spec)
sys.modules["check_k8s_manifests"] = checker  # dataclasses look their module up here
_spec.loader.exec_module(checker)


def _container(name="app", image="registry.example/uep-backend:abc1234",
               req=("250m", "512Mi"), lim=("1", "1Gi")):
    return {
        "name": name,
        "image": image,
        "resources": {
            "requests": {"cpu": req[0], "memory": req[1]},
            "limits": {"cpu": lim[0], "memory": lim[1]},
        },
    }


def _deployment(name="backend", replicas=2, container=None, volumes=None):
    return {
        "apiVersion": "apps/v1",
        "kind": "Deployment",
        "metadata": {"name": name, "namespace": "prd-uep"},
        "spec": {
            "replicas": replicas,
            "strategy": {"type": "RollingUpdate", "rollingUpdate": {"maxSurge": 1, "maxUnavailable": 0}},
            "template": {"spec": {
                "containers": [container or _container()],
                "volumes": volumes if volumes is not None else [
                    {"name": "tmp", "emptyDir": {"medium": "Memory", "sizeLimit": "256Mi"}}
                ],
            }},
        },
    }


def _service(kind="ClusterIP"):
    return {"apiVersion": "v1", "kind": "Service",
            "metadata": {"name": "backend", "namespace": "prd-uep"},
            "spec": {"type": kind, "ports": [{"port": 8000}]}}


def good():
    return [_deployment(), _service()]


def problems(docs):
    return "\n".join(checker.check(docs))


def test_the_good_fixture_passes():
    assert checker.check(good()) == []


@pytest.mark.parametrize("kind", ["PersistentVolumeClaim", "StatefulSet", "Job", "CronJob",
                                  "DaemonSet", "Namespace", "ClusterRole", "IngressClass"])
def test_forbidden_kind(kind):
    docs = good() + [{"apiVersion": "v1", "kind": kind, "metadata": {"name": "x", "namespace": "prd-uep"}}]
    assert f"{kind} x:" in problems(docs)


@pytest.mark.parametrize("service_type", ["LoadBalancer", "NodePort"])
def test_forbidden_service_type(service_type):
    assert f"Service type {service_type} is not allowed" in problems([_deployment(), _service(service_type)])


def test_host_path_and_host_network():
    doc = _deployment(volumes=[{"name": "h", "hostPath": {"path": "/var"}}])
    doc["spec"]["template"]["spec"]["hostNetwork"] = True
    out = problems([doc])
    assert "hostPath" in out
    assert "hostNetwork is not allowed" in out


def test_wrong_namespace():
    doc = _deployment()
    doc["metadata"]["namespace"] = "default"
    assert 'namespace is "default", not "prd-uep"' in problems([doc])


def test_missing_limit():
    container = _container()
    del container["resources"]["limits"]["cpu"]
    assert "no cpu limit is set" in problems([_deployment(container=container)])


def test_missing_request():
    container = _container()
    del container["resources"]["requests"]["memory"]
    assert "no memory request is set" in problems([_deployment(container=container)])


def test_request_above_limit():
    out = problems([_deployment(container=_container(req=("250m", "512Mi"), lim=("200m", "1Gi")))])
    assert "the cpu request is larger than its limit" in out


def test_below_limitrange_minimum():
    out = problems([_deployment(container=_container(req=("50m", "64Mi"), lim=("500m", "256Mi")))])
    assert "cpu request 50m is below the LimitRange minimum" in out
    assert "memory request 64Mi is below the LimitRange minimum" in out


def test_above_limitrange_maximum():
    out = problems([_deployment(container=_container(req=("1", "1Gi"), lim=("8", "8Gi")))])
    assert "cpu limit 8 is above the LimitRange maximum" in out
    assert "memory limit 8Gi is above the LimitRange maximum" in out


def test_over_quota_only_because_of_the_surge_pod():
    # 4 replicas x 1 CPU request = 4 (exactly the quota); the surge pod makes 5.
    container = _container(req=("1", "1Gi"), lim=("1", "1Gi"))
    fits = copy.deepcopy(_deployment(replicas=4, container=container))
    fits["spec"]["strategy"] = {"type": "Recreate"}
    assert checker.check([fits]) == []
    out = problems([_deployment(replicas=4, container=container)])
    assert "requests.cpu would reach 5 CPU" in out
    assert "above the quota of 4 CPU" in out


def test_disk_backed_empty_dir():
    out = problems([_deployment(volumes=[{"name": "tmp", "emptyDir": {}}])])
    assert 'emptyDir "tmp" is not memory-backed' in out


@pytest.mark.parametrize("image", ["registry.example/uep-backend:latest", "registry.example/uep-backend"])
def test_latest_or_untagged_image(image):
    assert "latest" in problems([_deployment(container=_container(image=image))])


def test_a_registry_with_a_port_is_not_mistaken_for_a_tag():
    assert checker.check([_deployment(container=_container(image="reg.local:5000/uep-backend"))]) != []
    assert checker.check([_deployment(container=_container(image="reg.local:5000/uep-backend:abc"))]) == []


def test_ephemeral_storage_breaks_the_zero_quota():
    container = _container()
    container["resources"]["requests"]["ephemeral-storage"] = "64Mi"
    assert "requests.ephemeral-storage" in problems([_deployment(container=container)])


def test_the_command_line_exit_codes(tmp_path):
    ok = tmp_path / "ok.yaml"
    ok.write_text(yaml.safe_dump_all(good()), encoding="utf-8")
    bad = tmp_path / "bad.yaml"
    bad.write_text(yaml.safe_dump_all(good() + [_service("NodePort")]), encoding="utf-8")
    assert checker.main(["x", str(ok)]) == 0
    assert checker.main(["x", str(bad)]) == 1


@pytest.mark.skipif(shutil.which("kubectl") is None, reason="kubectl not installed")
def test_the_real_kustomization_renders_and_passes():
    rendered = subprocess.run(
        ["kubectl", "kustomize", str(REPO / "deploy" / "k8s")],
        capture_output=True, text=True, check=True,
    ).stdout
    docs = [d for d in yaml.safe_load_all(rendered) if d]
    assert checker.check(docs) == []
    assert all(d["metadata"].get("namespace") == "prd-uep" for d in docs)
    kinds = sorted(d["kind"] for d in docs)
    assert kinds == ["ConfigMap", "ConfigMap", "Deployment", "Deployment", "Ingress", "Service", "Service"]
    # Every site value from site.env reached the manifests (no "from-site-env" left).
    assert "from-site-env" not in rendered
