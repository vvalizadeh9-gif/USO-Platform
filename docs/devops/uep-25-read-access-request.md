# Request: read-only Kubernetes access for UEP's System health page

**To:** DevOps (mtn-local cluster)
**Namespace:** `prd-uep` only
**File to review and apply:** `deploy/k8s/uep-reader-serviceaccount.yaml`

Hello,

UEP now has an Admin page called **System health**. It shows UEP's administrators whether the application is healthy: how many UEP pods are running and ready, recent restarts, the deployed version, and how much CPU and memory UEP uses against the namespace limits you set.

To show this, the UEP backend needs to **read** a few objects **in its own namespace, `prd-uep`**. We are asking for a ServiceAccount, a Role and a RoleBinding, all in `prd-uep`:

| Resource | API group | Verbs | Why |
|---|---|---|---|
| `pods` | core | get, list | Pods running/ready, restarts, start time, image tag |
| `resourcequotas` | core | get, list | The namespace's CPU and memory limits |
| `limitranges` | core | get, list | The per-container limits |
| `pods` | `metrics.k8s.io` | get, list | CPU and memory each pod uses (needs metrics-server) |

What it does **not** include:

- No write, delete, exec, port-forward or attach of any kind.
- No secrets, config maps, environment variables or logs.
- Nothing outside `prd-uep`, no ClusterRole or ClusterRoleBinding, no node or server information.

UEP reads these at most once every 30 seconds per pod and caches the answer.

**If you prefer not to grant it**, nothing breaks: the two blocks show "Not connected — needs read access from DevOps" and the rest of the page works. If metrics-server isn't installed, the pod information still shows and only the CPU and memory gauges stay grey.

**After you apply it**, we switch the backend to the `uep-reader` ServiceAccount with a small patch (`deploy/k8s/optional/uep-reader-patch.yaml`) at our next deploy. The token is mounted into the backend pods only.

Thank you.
