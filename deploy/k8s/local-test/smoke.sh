#!/usr/bin/env bash
# Runs KUBERNETES-RUNBOOK.md's kubectl steps against a LOCAL cluster (kind or
# k3d) that has prd-uep's quota and LimitRange applied (UEP-23). The CI job
# "Kubernetes smoke test" runs it on every push; you can run it too, with a
# local cluster and both images loaded into it:
#
#   deploy/k8s/local-test/smoke.sh local/uep-backend:ci local/uep-frontend:ci
#
# NEVER point kubectl at IT's cluster while running this: it creates the
# namespaces, applies a stand-in database and, in step 12, empties it.
set -euo pipefail

BACKEND_IMAGE=${1:?usage: smoke.sh <backend-image> <frontend-image>}
FRONTEND_IMAGE=${2:?usage: smoke.sh <backend-image> <frontend-image>}
NS=prd-uep
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
WORK=$(mktemp -d)
# A throwaway password full of characters that break a hand-written URL.
DB_PW='Kind@smoke:p/w%40#x'

say() { printf '\n==> %s\n' "$*"; }
fail() { echo "SMOKE TEST FAILED: $*" >&2; kubectl get pods -A || true; exit 1; }

context=$(kubectl config current-context)
case "$context" in
  kind-*|k3d-*|docker-desktop|minikube) ;;
  *) fail "kubectl points at \"$context\", which does not look like a local cluster." ;;
esac

registry=${BACKEND_IMAGE%/uep-backend:*}
tag=${BACKEND_IMAGE##*:}
[ "${FRONTEND_IMAGE}" = "${registry}/uep-frontend:${tag}" ] \
  || fail "images must be <registry>/uep-backend:<tag> and <registry>/uep-frontend:<tag>"

say "Namespace with prd-uep's quota and LimitRange"
kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f "$HERE/prd-uep-rules.yaml"

say "Stand-in database (namespace dbtest, port 5444)"
kubectl create namespace dbtest --dry-run=client -o yaml | kubectl apply -f -
kubectl create secret generic postgres -n dbtest --from-literal=password="$DB_PW" \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f "$HERE/postgres.yaml"
kubectl rollout status deploy/postgres -n dbtest --timeout=180s

say "Step 2: site.env for the local cluster"
cp -r "$REPO/deploy/k8s/." "$WORK/"
sed -i \
  -e "s#^REGISTRY=.*#REGISTRY=${registry}#" \
  -e "s#^HOSTNAME=.*#HOSTNAME=uep.test#" \
  -e "s#^INGRESS_CLASS=.*#INGRESS_CLASS=nginx#" \
  -e "s#^DB_HOST=.*#DB_HOST=postgres.dbtest.svc.cluster.local#" \
  "$WORK/site.env"
sed -i "s/newTag: set-by-ci/newTag: ${tag}/" "$WORK/kustomization.yaml"
kubectl kustomize "$WORK" > "$WORK/uep-k8s.yaml"
python3 "$REPO/scripts/check_k8s_manifests.py" "$WORK/uep-k8s.yaml"
python3 - "$WORK/uep-k8s.yaml" "$WORK/uep-k8s-no-ingress.yaml" <<'PY'
import sys, yaml
docs = [d for d in yaml.safe_load_all(open(sys.argv[1])) if d and d.get("kind") != "Ingress"]
yaml.safe_dump_all(docs, open(sys.argv[2], "w"), sort_keys=False)
PY

say "Step 4: the Secret"
kubectl create secret generic uep-secrets -n "$NS" \
  --from-literal=DB_USER=uep_app_svc \
  --from-literal=DB_PASSWORD="$DB_PW" \
  --from-literal=JWT_SECRET_KEY="$(openssl rand -hex 32)" \
  --from-literal=FIRST_ADMIN_USERNAME=admin \
  --from-literal=FIRST_ADMIN_PASSWORD='Kind-smoke-admin-passw0rd' \
  --from-literal=FIRST_ADMIN_FULLNAME='Smoke Admin' \
  --dry-run=client -o yaml | kubectl apply -f -

say "Step 5: everything except the Ingress"
kubectl apply -f "$WORK/uep-k8s-no-ingress.yaml"

say "Step 6: check"
kubectl rollout status deploy/backend -n "$NS" --timeout=600s || fail "backend did not roll out"
kubectl rollout status deploy/frontend -n "$NS" --timeout=300s || fail "frontend did not roll out"
kubectl get pods -n "$NS"
kubectl logs -n "$NS" deploy/backend | grep '^\[preflight\]'
for pod in $(kubectl get pods -n "$NS" -l app.kubernetes.io/name=backend -o name); do
  log=$(kubectl logs -n "$NS" "$pod")
  grep -q '^\[preflight\]   Database check passed.' <<<"$log" || fail "$pod: no passing pre-flight"
  grep -q 'Migrations applied' <<<"$log" || fail "$pod: migrations not applied"
  if grep -qF -- "$DB_PW" <<<"$log"; then fail "$pod: the database password is in the log"; fi
done
curl_in_cluster() {
  kubectl run "curl-$RANDOM" -n dbtest --rm -i --restart=Never --quiet \
    --image=curlimages/curl:8.10.1 -- curl -fsS "$@"
}
curl_in_cluster http://frontend.prd-uep.svc.cluster.local:8080/api/health/ready | grep '"ready"' >/dev/null \
  || fail "readiness through the frontend Service"

# After a pod is replaced, the Service's endpoints and nginx's upstream catch
# up a few seconds after "rolled out": ask again for up to a minute before
# calling it a failure (one try made this step flaky in CI).
ready_soon() {
  local i
  for i in $(seq 1 12); do
    if curl_in_cluster http://frontend.prd-uep.svc.cluster.local:8080/api/health/ready 2>/dev/null \
        | grep '"ready"' >/dev/null; then
      return 0
    fi
    sleep 5
  done
  fail "$1"
}

say "Step 5 (last part): the Ingress"
kubectl apply -f "$WORK/uep-k8s.yaml"
kubectl get ingress -n "$NS" uep

say "A deleted pod is replaced and UEP stays ready"
kubectl delete "$(kubectl get pods -n "$NS" -l app.kubernetes.io/name=backend -o name | head -1)" -n "$NS"
kubectl rollout status deploy/backend -n "$NS" --timeout=300s
ready_soon "readiness after a backend pod was replaced"

say "Step 10: restart; step 9: roll back"
kubectl rollout restart deploy/backend -n "$NS"
kubectl rollout status deploy/backend -n "$NS" --timeout=600s
kubectl rollout undo deploy/backend -n "$NS"
kubectl rollout status deploy/backend -n "$NS" --timeout=600s

run_task() {
  # Steps 11/12: the one-off task pod from optional/task-pod.example.yaml.
  local args_line=$1
  kubectl delete pod uep-task -n "$NS" --ignore-not-found --wait=true
  sed -e "s#PASTE_THE_BACKEND_IMAGE_HERE#${BACKEND_IMAGE}#" \
      -e "s#^      args: .*#      args: ${args_line}#" \
      "$REPO/deploy/k8s/optional/task-pod.example.yaml" | kubectl apply -f -
  if ! kubectl wait pod/uep-task -n "$NS" --for=jsonpath='{.status.phase}'=Succeeded --timeout=180s; then
    kubectl logs -n "$NS" uep-task || true
    fail "task pod $args_line did not succeed"
  fi
  kubectl logs -n "$NS" uep-task
}

say "Step 11: reclaim_uploads --dry-run in a task pod"
run_task '["app.scripts.reclaim_uploads", "--dry-run"]'

say "Step 12: empty the database"
kubectl scale deploy/backend -n "$NS" --replicas=0
kubectl wait --for=delete pod -n "$NS" -l app.kubernetes.io/name=backend --timeout=180s
run_task '["app.scripts.empty_database"]' | grep 'Nothing dropped' >/dev/null
run_task '["app.scripts.empty_database", "--confirm", "uep_prd"]' | grep 'Dropped. After: 0 table' >/dev/null
run_task '["app.scripts.db_preflight"]' | grep 'The database is empty' >/dev/null
kubectl delete pod uep-task -n "$NS"
kubectl scale deploy/backend -n "$NS" --replicas=2
kubectl rollout status deploy/backend -n "$NS" --timeout=600s
ready_soon "readiness after scaling the backend back up"

say "Quota in use"
kubectl describe resourcequota -n "$NS"

echo
echo "SMOKE TEST PASSED"
