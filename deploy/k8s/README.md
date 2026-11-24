# UEP on Kubernetes — the files

Everything needed to run UEP in namespace **`prd-uep`** on IT's shared cluster **`mtn-local`** (Rancher 2.8, Kubernetes 1.30), against IT's PostgreSQL. The step-by-step guide is [KUBERNETES-RUNBOOK.md](../../KUBERNETES-RUNBOOK.md); this page explains the files.

```
kubectl kustomize deploy/k8s/     # show the finished manifests
kubectl apply -k deploy/k8s/      # apply them
```

Most of the time you will not run either: the GitHub **Build images** workflow renders these files into one ready-to-import `uep-k8s-<sha>.yaml`, with the image tag filled in, for Rancher's *Import YAML*.

## The four site values — `site.env`

These are the only values that differ per site. They live **only** in [`site.env`](site.env); kustomize copies each into every manifest that needs it. Until IT answers, they are placeholders starting with `CHANGE_ME_`.

| Key in `site.env` | Placeholder | What it is | Where to get it | Used in |
|---|---|---|---|---|
| `REGISTRY` | `CHANGE_ME_REGISTRY` | Where the cluster pulls images from (no trailing `/`) | Default `ghcr.io/vvalizadeh9-gif` if the cluster can reach the internet. Otherwise IT's registry — also visible in the `image:` field of other teams' workloads in Rancher | both Deployments' `image:` |
| `HOSTNAME` | `CHANGE_ME_HOSTNAME` | The address users type, without `https://` | IT (DNS name for the Ingress) | Ingress host; `CORS_ORIGINS` and `APP_BASE_URL` in the ConfigMap |
| `INGRESS_CLASS` | `CHANGE_ME_INGRESS_CLASS` | The Ingress controller's class | IT, or the *Ingress Class* of other teams' Ingresses in Rancher | Ingress `ingressClassName` |
| `DB_HOST` | `CHANGE_ME_DB_HOST` | The database server, as seen from inside the cluster | IT. `t3vl1177` may only resolve on some networks; ask for the full name or the IP | `DB_HOST` in the ConfigMap |

`site.env` holds no secrets and is committed.

## File by file

| File | What it does |
|---|---|
| `kustomization.yaml` | The entry point. Sets `namespace: prd-uep` and common labels, lists the files, sets the image tag (`images:`), and copies the `site.env` values into place (`configMapGenerator` + `replacements`). |
| `site.env` | The four site values above. |
| `sizing.yaml` | Replicas, CPU and memory for both containers — the one place to change them. |
| `configmap.yaml` | `uep-config`: every non-secret setting (database port and name, workers, proxy hops, upload size, logging, session and login limits, nginx mode). |
| `secret.example.yaml` | Template for `uep-secrets` (six keys, all `CHANGE_ME`) and notes for the registry pull secret. **Not** in the kustomization; the real Secret is created by hand in Rancher. |
| `backend-deployment.yaml` | The FastAPI backend: probes, security settings, memory-backed `/tmp`, rolling-update rules. |
| `backend-service.yaml` | Service `backend` on port 8000 — the name nginx proxies `/api` to. |
| `frontend-deployment.yaml` | nginx: the app's files, security headers, `/api` proxy. Read-only filesystem with memory-backed `/tmp` and `/etc/nginx/conf.d`. |
| `frontend-service.yaml` | Service `frontend` on port 8080 — what the Ingress points at. |
| `ingress.yaml` | One host, path `/` → `frontend:8080`, with ingress-nginx annotations for 25 MB uploads and 600 s timeouts. TLS block commented until IT provides a certificate. Applied last. |
| `optional/networkpolicy.yaml` | Pod firewall rules. Not applied by default; ask IT first. |
| `optional/ephemeral-storage.yaml` | Adds ephemeral-storage values to both containers, only if IT says pods must declare them. |

The kustomization also creates a small ConfigMap `uep-site` holding the `site.env` values; it is only the source for the copies and is harmless.

## What the cluster allows, and how UEP fits

`prd-uep` has no storage, no Jobs and no cluster-wide objects. So:

- **Nothing is stored on disk.** Uploaded files live in PostgreSQL (UEP-20). Both containers have a read-only root filesystem; their only writable paths are memory-backed `emptyDir` volumes.
- **No migration Job.** Each backend pod migrates on start under a PostgreSQL advisory lock; the second pod waits, then finds nothing to do.
- **Services are `ClusterIP` only.** Users reach UEP through IT's Ingress.

`scripts/check_k8s_manifests.py` checks the rendered output against all of this, and runs in CI.

### Resource sums

Every container sets CPU and memory **requests and limits** explicitly. Without them the LimitRange's default (`cpu 200m / memory 256Mi`) would apply — below the backend's request, which the cluster rejects.

| Container | requests | limits | LimitRange (min … max) |
|---|---|---|---|
| backend | `cpu 250m`, `memory 512Mi` | `cpu 1`, `memory 1Gi` | `100m/128Mi … 4/4Gi` ✔ |
| frontend | `cpu 100m`, `memory 128Mi` | `cpu 500m`, `memory 256Mi` | ✔ |

Quota check, 2 replicas each **plus one extra pod per Deployment during a rolling update** (3 backend + 3 frontend pods at the peak):

| | backend ×3 | frontend ×3 | total | quota |
|---|---|---|---|---|
| requests.cpu | 750m | 300m | **1.05** | 4 |
| requests.memory | 1536Mi | 384Mi | **1.875Gi** | 8Gi |
| limits.cpu | 3 | 1.5 | **4.5** | 16 |
| limits.memory | 3Gi | 768Mi | **3.75Gi** | 32Gi |
| pods | 3 | 3 | **6** | 100 |

Objects: 2 Deployments (quota 25), 2 Services (25), 2 ConfigMaps + the Secret(s) (25 / 60).
