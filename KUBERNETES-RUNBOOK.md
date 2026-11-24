# Running UEP on IT's Kubernetes cluster

This guide takes you from nothing to UEP running on IT's shared cluster, and covers the routine jobs after that. It is written for someone who is not a programmer.

**How to read it.** One action per numbered step. After each step, **"You should see"** tells you what success looks like. If you see something else, stop and look in [section 13](#13-common-problems).

**Rancher first.** Every routine step is done in **Rancher** (the web panel IT gave you). A `kubectl` command is given second, for when you have it. Steps marked **🖥 Admin server** need a live connection to the cluster, which does not work over your VPN — do those from the Admin server, or use the Rancher alternative given.

Where the cluster's details are: [deploy/k8s/README.md](deploy/k8s/README.md). Docker Compose on one machine is a different setup: [RUNBOOK.md](RUNBOOK.md).

### Words used in this guide

| Word | What it means here |
|---|---|
| **Cluster** | IT's group of servers that run containers: `mtn-local`. Shared with other teams. |
| **Namespace** | UEP's own corner of the cluster: `prd-uep`. You can only see and change things in it. |
| **Image** | A packaged copy of a UEP program. There are two: `uep-backend` (the server) and `uep-frontend` (the web pages). |
| **Registry** | A store for images, which the cluster downloads them from. |
| **Pod** | One running copy of an image. UEP normally runs two backend pods and two frontend pods. |
| **Deployment** | The instruction "keep 2 pods of this image running". If a pod dies, the Deployment starts a new one. |
| **Service** | A fixed in-cluster name for a set of pods (`backend`, `frontend`), so they can find each other. |
| **Ingress** | The cluster's front door: it sends requests for UEP's web address to the frontend. IT controls it. |
| **ConfigMap** | A list of ordinary settings handed to the pods (`uep-config`). |
| **Secret** | A list of passwords and keys handed to the pods (`uep-secrets`). Rancher hides the values. |
| **kubeconfig** | A small file that lets the `kubectl` program talk to the cluster as you. |

---

## 1. What you need before starting

1. **VPN.** Connect the SSL VPN.
   *You should see:* `kubepanel.mtnirancell.ir` opens in your browser.
2. **Rancher login.** Sign in at `kubepanel.mtnirancell.ir` with your LDAP (Windows) user name and password.
   *You should see:* the Rancher home page with cluster **mtn-local** listed.
3. **Open UEP's namespace.** Click **mtn-local**. In the namespace selector at the top, choose **prd-uep** only.
   *You should see:* menus on the left (**Workloads**, **Service Discovery**, **Storage**, …) and nothing from other teams.
4. **The database password.** IT sends it separately. Keep it in your password manager. It goes in exactly one place: the Secret in step 4. Never in a file, chat or email.
5. **Registry access.** By default the images are on GitHub's registry and public, so nothing is needed. If IT says the cluster must use IT's registry, get its address and a login from IT ([section 3](#3-get-the-images)).
6. **Optional — kubectl on Windows.** Only needed for the `kubectl` alternatives. No installation:
   1. Download `kubectl.exe` for version 1.30 from `https://dl.k8s.io/release/v1.30.4/bin/windows/amd64/kubectl.exe` and save it in a folder such as `C:\Tools`.
   2. In Rancher, on the **mtn-local** cluster page, click **Download KubeConfig** (the page-with-arrow icon at the top right). Save the file as `C:\Tools\mtn-local.yaml`. **It contains a personal token — never share it, never put it in GitHub.** The repository ignores files with this name on purpose.
   3. In PowerShell, every time you open a new window:
      ```powershell
      $env:KUBECONFIG = "C:\Tools\mtn-local.yaml"; Set-Location C:\Tools
      ```
   4. Test it:
      ```powershell
      .\kubectl.exe get pods -n prd-uep
      ```
      *You should see:* a list of pods, or `No resources found` before the first deploy.
   **The token expires.** If kubectl says `Unauthorized` or `You must be logged in`, download a fresh kubeconfig (step 6.2) and save it over the old one.

> Everywhere below, `kubectl` means `.\kubectl.exe` with `$env:KUBECONFIG` set as above.

---

## 2. Fill in the site values

Four values differ per site. They live in **one file**, [`deploy/k8s/site.env`](deploy/k8s/site.env), and nowhere else.

| Line in `site.env` | What to put | Where to get it |
|---|---|---|
| `REGISTRY=` | `ghcr.io/vvalizadeh9-gif` (the default) — or IT's registry | IT. Hint: in Rancher, open any other team's Deployment and look at its image — the part before the image name is their registry |
| `HOSTNAME=` | The web address users will type, without `https://` | IT (part of the Ingress ticket, [section 7](#7-ask-it-for-the-web-address-ingress)). Leave the placeholder until you have it — everything else works without it |
| `INGRESS_CLASS=` | The Ingress class name | IT |
| `DB_HOST=` | The database server's full name or IP as seen from the cluster | IT. `t3vl1177` alone may not be found from inside the cluster |

1. On GitHub, open the repository, go to `deploy/k8s/site.env`, click the pencil (**Edit**).
2. Replace each `CHANGE_ME_…` you have an answer for. Keep the `KEY=` part exactly as it is.
3. Click **Commit changes** (directly to `main` is fine for this file, or through a pull request).
   *You should see:* a new run of **Build images** starting on the **Actions** tab. Its summary says which placeholders are still left.

---

## 3. Get the images

The images are built on GitHub — you never need Docker.

1. On GitHub, open the **Actions** tab and click **Build images** on the left.
2. Click the newest run with a **green tick**.
   *You should see:* a summary with **Image tag** (seven characters, such as `1a2b3c4`) and **Artifact to download** `uep-1a2b3c4`.
3. Scroll to **Artifacts** at the bottom and download `uep-<tag>`. Unzip it.
   *You should see:* `uep-k8s-<tag>.yaml`, `uep-k8s-<tag>-no-ingress.yaml`, `uep-images-<tag>.tar.gz` and `uep-images-<tag>.tar.gz.sha256`.

**If `REGISTRY` is GitHub's (`ghcr.io/vvalizadeh9-gif`)** — the default — the run has already pushed both images there. Two one-time checks:

4. **Make both packages public (once).** On GitHub: your profile picture → **Your profile** → **Packages** → `uep-backend` → **Package settings** → **Danger Zone** → **Change visibility** → **Public**. Repeat for `uep-frontend`. The images hold no secrets (passwords only ever live in the cluster's Secret), and the code is already public.
   *You should see:* the package page no longer says **Private**.
5. **Check the cluster can reach GitHub.** This is what your small test app on 23 Nov checks. If the cluster cannot reach `ghcr.io`, pods will show `ImagePullBackOff` ([section 13](#13-common-problems)) — then use IT's registry below.

**If `REGISTRY` is IT's registry** — two ways to get the images there:

- **Automatic (once IT gives a login):** on GitHub, **Settings → Secrets and variables → Actions**: add the **variable** `UEP_REGISTRY` (for example `registry.example.local/uep`) and the **secrets** `UEP_REGISTRY_USER` and `UEP_REGISTRY_PASSWORD`. Every future run then pushes there too. This only works if GitHub can reach IT's registry from the internet — usually it cannot.
- **By hand, 🖥 Admin server** (or any internal machine with Docker or skopeo). Copy `uep-images-<tag>.tar.gz` and its `.sha256` file there, then:

  > **Waiting on IT:** the registry address, login and whether Docker or skopeo is available. Replace `REGISTRY` and `TAG` below; nothing else changes.

  ```bash
  REGISTRY=registry.example.local/uep   # from IT
  TAG=1a2b3c4                            # from the run summary
  sha256sum -c uep-images-$TAG.tar.gz.sha256     # must say: OK

  # With Docker:
  docker load -i uep-images-$TAG.tar.gz
  docker login "${REGISTRY%%/*}"
  for i in uep-backend uep-frontend; do
    docker tag  $i:$TAG $REGISTRY/$i:$TAG
    docker push $REGISTRY/$i:$TAG
  done

  # Or with skopeo (no Docker needed):
  gunzip -k uep-images-$TAG.tar.gz
  for i in uep-backend uep-frontend; do
    skopeo copy --dest-creds "<user>:<password>" \
      docker-archive:uep-images-$TAG.tar:$i:$TAG docker://$REGISTRY/$i:$TAG
  done
  ```
  *You should see:* each push ending with a `digest: sha256:…` line.

---

## 4. Create the Secret

The Secret holds the six passwords and keys. You create it **once**, by hand, in Rancher — so the password is never typed into a command history or saved in a file.

1. **Make a JWT key** (the key that signs sign-ins). Open PowerShell and paste this one line:
   ```powershell
   $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | % { $_.ToString('x2') })
   ```
   *You should see:* 64 letters and digits. Copy them. (On Linux or the Admin server: `openssl rand -hex 32`.)
2. In Rancher: **Storage → Secrets → Create → Opaque**.
3. **Namespace:** `prd-uep`. **Name:** `uep-secrets` (exactly).
4. Add these six keys (**Add** for each row). Key names must match exactly, including capitals:

   | Key | Value |
   |---|---|
   | `DB_USER` | `uep_app_svc` |
   | `DB_PASSWORD` | the database password from IT (any characters are fine) |
   | `JWT_SECRET_KEY` | the 64 characters from step 1 |
   | `FIRST_ADMIN_USERNAME` | the first administrator's user name, e.g. `admin` |
   | `FIRST_ADMIN_PASSWORD` | a strong password for that administrator (you change it at first login) |
   | `FIRST_ADMIN_FULLNAME` | e.g. `System Administrator` |

5. Click **Create**.
   *You should see:* `uep-secrets` in the list, type **Opaque**, **6** data entries.

**Only if IT says the registry needs a login:** **Storage → Secrets → Create → Registry**, namespace `prd-uep`, name `uep-registry`, with the registry address, user and password from IT. Then in `deploy/k8s/backend-deployment.yaml` and `frontend-deployment.yaml` remove the `# ` in front of the three `imagePullSecrets` lines, commit, and use the next build.

*kubectl alternative* (🖥 Admin server, never on a shared machine — the values end up in the shell history): copy `deploy/k8s/secret.example.yaml` to `deploy/k8s/secret.yaml` (git-ignored), fill in the values, then `kubectl apply -n prd-uep -f deploy/k8s/secret.yaml`, then delete `secret.yaml`.

---

## 5. Deploy

Until IT has added the web address, deploy **everything except the Ingress** — use the `-no-ingress` file. UEP can be fully checked without it ([section 6](#6-check-that-it-works)).

1. In Rancher, click **Import YAML** (the up-arrow icon at the top right).
2. **Default Namespace:** `prd-uep`.
3. Click **Read from File** and choose `uep-k8s-<tag>-no-ingress.yaml` (or open it in Notepad and paste the whole text).
4. Click **Import**.
   *You should see:* a list of created objects, all green: ConfigMap `uep-config`, ConfigMap `uep-site`, Service `backend`, Service `frontend`, Deployment `backend`, Deployment `frontend`.
5. **When IT has added the web address** ([section 7](#7-ask-it-for-the-web-address-ingress)): put the host name and Ingress class in `site.env` (section 2), take the newest green build, and import the full `uep-k8s-<tag>.yaml` the same way. Importing again is safe: unchanged objects stay as they are.

*kubectl alternative:* `kubectl apply -f uep-k8s-<tag>-no-ingress.yaml`, later `kubectl apply -f uep-k8s-<tag>.yaml`. From a checkout of the repository, `kubectl apply -k deploy/k8s/` applies everything at once (put the image tag in `deploy/k8s/kustomization.yaml` under `images:` first).

If Rancher refuses the import with `exceeded quota` or `must specify …`, see [section 13](#13-common-problems).

---

## 6. Check that it works

The first start takes a few minutes: each backend pod checks the database, then builds UEP's tables.

1. Rancher: **Workloads → Deployments**.
   *You should see:* `backend` **2/2** and `frontend` **2/2**, state **Active**, within about 5 minutes.
2. **Workloads → Pods**, click a pod whose name starts with `backend-`, then **⋮ → View Logs**. Scroll to the top.
   *You should see* lines like:
   ```
   [preflight] ✔ Settings present: uep_app_svc@<db host>:5444/uep_prd.
   [preflight] ✔ The name "<db host>" resolves to 10.x.x.x.
   [preflight] ✔ <db host> answers on port 5444.
   [preflight] ✔ Logged in as "uep_app_svc".
   [preflight] ✔ PostgreSQL 16.x (UEP is tested on 16).
   [preflight] ✔ Connected to database "uep_prd".
   [preflight] ✔ UEP can create its tables (test table created and rolled back).
   [preflight] ✔ The database is empty. UEP will create its tables on first start.
   [preflight]   Database check passed.
   [migrate] Migration lock taken.
   [migrate] Migrations applied.
   ...
   [entrypoint] Starting API server with 2 worker(s)...
   ```
   The second backend pod may show `Waiting for another pod to finish migrations` — that is normal.
   **A `✘` line** says exactly what is wrong and what to ask IT for. Copy it into your message to IT. The pod restarts by itself and tries again; the same lines appear at the top of each attempt.
3. **Readiness.** On **Workloads → Pods**, every pod shows **Running** and **1/1** ready. A backend pod that is Running but **0/1** cannot reach the database right now; it gets traffic again as soon as it can.

*kubectl alternative:*
```powershell
kubectl get pods -n prd-uep
kubectl logs -n prd-uep deploy/backend
```
(Plain `kubectl logs`, without `-f` — following a log needs a live connection.)

---

## 7. Ask IT for the web address (Ingress)

Send IT a **cluster modification request** with this text (fill in the two blanks):

> Please add an Ingress for the UEP application in namespace **prd-uep** on cluster **mtn-local**:
> - Host name: **\_\_\_\_\_\_\_\_** (please suggest one if we have no preference)
> - Path `/` → Service **frontend**, port **8080** (ClusterIP)
> - Request body limit: **25 MB** (staff upload letters and CPM workbooks)
> - Proxy read and send timeouts: **600 seconds** (a full monthly CPM import takes several minutes)
> - Request buffering: off, if your controller supports it
> - TLS: a certificate for the host name, please — as Secret **uep-tls** in prd-uep, or terminated at your controller
> - Please tell us the **Ingress class** name to use.
>
> Our manifest is ready (`deploy/k8s/ingress.yaml`, with ingress-nginx annotations for the settings above). We can apply it ourselves if you give the class name and host, or you can create it.

When IT answers: host name and class go in `site.env` (section 2). If IT gave a certificate as `uep-tls`, remove the `# ` from the `tls:` block in `deploy/k8s/ingress.yaml` and put the host name there too. Then step 5.5.

---

## 8. First login

1. Open `https://<host name>` (from IT) in the browser, on the VPN.
   *You should see:* the UEP sign-in page.
2. Sign in with `FIRST_ADMIN_USERNAME` and `FIRST_ADMIN_PASSWORD` from the Secret.
3. **Change that password now:** Admin → Users → your user → Edit.
   *You should see:* "saved"; signing out and in again works with the new password.

Changing `FIRST_ADMIN_PASSWORD` in the Secret later does **not** change the account — it is only used when the account is first created.

---

## 9. Update to a new version, or roll back

**Update**

1. Wait for the **Build images** run of the new version to turn green; note its tag.
2. Get the images into the registry ([section 3](#3-get-the-images)) — automatic for GitHub's registry.
3. Import the new `uep-k8s-<tag>.yaml` (or the `-no-ingress` file, if there is no Ingress yet) exactly as in [section 5](#5-deploy).
4. **Workloads → Deployments**: both roll one pod at a time. Old pods keep serving until each new one is ready.
   *You should see:* `backend 2/2`, `frontend 2/2` again, and the pods' image ending in the new tag.

If a new backend pod never becomes ready (its log shows a `✘` or an error), the old pods **keep serving** — nothing is broken for users. Roll back:

**Roll back**

- Rancher: **Workloads → Deployments → backend → ⋮ → Rollback**, choose the previous revision, **Rollback**. Do the same for `frontend` if needed.
  *You should see:* the Deployment rolls back to the previous image tag.
- *kubectl:* `kubectl rollout undo -n prd-uep deploy/backend` (and `deploy/frontend`).

A rollback goes back to the previous **images**. Database migrations are not undone. Usually the older version works with the newer tables; if a release cannot be rolled back, its CHANGELOG entry says so.

---

## 10. Change a setting or a secret

Pods read settings only when they start.

1. Change the value:
   - **Ordinary setting:** **Storage → ConfigMaps → uep-config → ⋮ → Edit Config**. (Better still, change `deploy/k8s/configmap.yaml` on GitHub and import the next build's file, so the change is not lost at the next deploy.)
   - **Secret:** **Storage → Secrets → uep-secrets → ⋮ → Edit Config**.
2. **Workloads → Deployments → backend → ⋮ → Redeploy** (and `frontend`, if it was an nginx setting).
   *You should see:* pods replaced one at a time, then `2/2` again.

*kubectl:* `kubectl rollout restart -n prd-uep deploy/backend`.

Changing `JWT_SECRET_KEY` signs everyone out. Changing `DB_PASSWORD` must happen together with IT changing it on the database.

---

## 11. Clean up unused uploaded files (UEP-20)

Uploaded files are stored in the database. Deleting a letter does not delete its file immediately (other records may share it); this cleanup removes files nothing points at any more. Run it occasionally — there is no scheduler. Always **look first** (`--dry-run`), then for real.

**Rancher way (works over VPN) — a one-off task pod:**

1. **Workloads → Deployments → backend**: copy the image shown (like `ghcr.io/vvalizadeh9-gif/uep-backend:1a2b3c4`).
2. Open [`deploy/k8s/optional/task-pod.example.yaml`](deploy/k8s/optional/task-pod.example.yaml) on GitHub, click **Raw**, copy all of it into Notepad.
3. Replace `PASTE_THE_BACKEND_IMAGE_HERE` with the image from step 1.
4. Change the `args:` line to the dry-run line: `args: ["app.scripts.reclaim_uploads", "--dry-run"]`.
5. **Import YAML**, namespace `prd-uep`, paste, **Import**.
6. **Workloads → Pods → uep-task → ⋮ → View Logs**.
   *You should see:* how many files would be removed and how much space, and the pod's state **Succeeded**.
7. Delete the pod: **⋮ → Delete**.
8. If the numbers look right, repeat steps 4–7 with `args: ["app.scripts.reclaim_uploads"]`.

**🖥 Admin server way:**
```bash
kubectl exec -n prd-uep deploy/backend -- python -m app.scripts.reclaim_uploads --dry-run
kubectl exec -n prd-uep deploy/backend -- python -m app.scripts.reclaim_uploads
```

---

## 12. Empty the practice database before go-live

> ⚠️ **DESTRUCTIVE. There is no undo.** This deletes everything UEP has stored in `uep_prd`: every user except the one re-created from the Secret, every site, letter and uploaded file. Do it **once**, right before go-live, after all practice is finished. Tell the team first.

Practice deploys use the real database `uep_prd` (there is no test database), so it has to be emptied before real use. The backend must be **stopped** first, so nothing writes while it is emptied — the tool refuses otherwise.

1. **Check before.** Run the task pod ([section 11](#11-clean-up-unused-uploaded-files-uep-20), steps 1–7) with
   `args: ["app.scripts.empty_database"]`
   *You should see:* `Before: N table(s) in schema public, N of them owned by "uep_app_svc"` and `Nothing dropped`. Write N down.
2. **Stop the backend.** **Workloads → Deployments → backend**, press **−** until **Scale** shows **0** (or **⋮ → Edit Config → Replicas 0 → Save**).
   *You should see:* `backend 0/0`, and no `backend-…` pods under **Workloads → Pods**. Users now see an error page — expected.
   *kubectl:* `kubectl scale -n prd-uep deploy/backend --replicas=0`
3. **Empty it.** Task pod again with
   `args: ["app.scripts.empty_database", "--confirm", "uep_prd"]`
   *You should see:* `✔ Dropped. After: 0 table(s) in schema public.` If it says `other session(s) … connected`, a backend pod is still running — wait a minute and repeat this step.
4. **Check after.** Task pod with `args: ["app.scripts.db_preflight"]`.
   *You should see:* `✔ The database is empty. UEP will create its tables on first start.`
5. Delete the task pod (**⋮ → Delete**).
6. **Start the backend.** Scale `backend` back to **2**.
   *You should see:* `backend 2/2` after a few minutes; the log shows the pre-flight, then `Migrations applied`.
7. Sign in with the first admin from the Secret ([section 8](#8-first-login)) and change its password.

**Other ways to do step 3** (with the backend stopped as in step 2):
- **🖥 Admin server**, with Docker and network access to the database: `docker run --rm -e DB_HOST=… -e DB_PORT=5444 -e DB_NAME=uep_prd -e DB_USER=uep_app_svc -e DB_PASSWORD -e APP_ENV=production --entrypoint python <backend image> -m app.scripts.empty_database --confirm uep_prd` (export `DB_PASSWORD` first; it is not typed on the command line).
- **Ask the database team** to drop every table, sequence and enum type owned by `uep_app_svc` in schema `public` of `uep_prd` — not the schema itself, and not the user's permissions.

---

## 13. Common problems

| What you see | What it means | What to do |
|---|---|---|
| Pod state **ImagePullBackOff** or **ErrImagePull** | The cluster cannot download the image | Check `REGISTRY` in `site.env` and the tag. For GitHub's registry: are both packages **public** (section 3.4)? Can the cluster reach `ghcr.io`? If not, use IT's registry. For IT's registry: does it need the `uep-registry` pull secret (section 4)? |
| Backend pod **CrashLoopBackOff** / restarting | It stops during start-up | Open its log (**⋮ → View Logs**) and read the top: the `[preflight]` lines say what is wrong. If they are all ✔, read the first error below them. |
| `[preflight] ✘ The name "…" cannot be found from here` | The cluster does not know the database's name | Ask IT for the full DNS name or the IP; put it in `DB_HOST` (`site.env`). |
| `[preflight] ✘ Cannot reach … on port 5444` | A firewall blocks the cluster from the database | Ask the database team to allow **all** the cluster's node IPs: `10.219.6.34–40`, `10.219.6.88–97`, `10.222.213.40–50`, `10.224.248.139–145` (traffic leaves from whichever node the pod runs on). |
| `[preflight] ✘ The database refused user "uep_app_svc"` | Wrong password, or the account is locked/missing | Check `DB_PASSWORD` in the Secret (section 10), or ask IT to confirm the account. |
| `[preflight] ✘ User "uep_app_svc" cannot create tables` | The login lacks CREATE | Ask IT to make it the owner of `uep_prd`, or grant CREATE on schema `public`. |
| `[migrate] … Gave up … waiting for another pod` | Another session holds the migration lock | Usually a pod that was killed mid-start; wait and Redeploy. If it repeats, ask the database team to look for a session holding an advisory lock (the message gives the number). |
| Import refused: `exceeded quota` | UEP would use more CPU/memory than prd-uep allows | Lower replicas or resources in `deploy/k8s/sizing.yaml` (sums in `deploy/k8s/README.md`). CI checks this, so it usually means IT changed the quota — ask IT for the new numbers. |
| Import refused: `must specify limits.ephemeral-storage` (or `requests.…`), or `exceeded quota … ephemeral-storage` | The cluster wants pods to declare disk use | Ask IT for the values (and to raise the ephemeral-storage quota from 0), then use `deploy/k8s/optional/ephemeral-storage.yaml` as its header explains. |
| kubectl: `Unauthorized` / `You must be logged in to the server` | Your kubeconfig token expired | Download a fresh kubeconfig from Rancher (section 1.6). |
| Rancher **Kubectl Shell** or **Execute Shell** says *Disconnected* after a few seconds | Live connections do not work over the VPN | Use the Rancher screens and task pods in this guide, or the Admin server. |
| Upload fails with **413** | A file is larger than the limit somewhere on the way | UEP allows 20 MB (`MAX_UPLOAD_MB`); nginx 25 MB. If the Ingress refuses first, ask IT to set its body limit to 25 MB (section 7). |
| CPM import ends with **504** | The Ingress gave up waiting | Ask IT to set the Ingress read/send timeouts to 600 s (section 7). The import may still finish in the background; check Import History before retrying. |
| Backend pods **Running** but **0/1** ready | They cannot reach the database right now | Usually temporary; they become ready on their own. If it lasts, check the database with the task pod (`app.scripts.db_preflight`). |
