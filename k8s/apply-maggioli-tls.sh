export NAMESPACE=${1}

# prima il namespace
kubectl create ns $NAMESPACE || true

# controlla se deve pushare registry secret
if [ -n "$CI_REGISTRY_USR" ]; then
  echo "Deploying Registry Secret <rd-registry>.."
  kubectl delete secret rd-registry -n "$NAMESPACE"
  kubectl create secret docker-registry rd-registry \
    --docker-server="$CI_REGISTRY" \
    --docker-username="$CI_REGISTRY_USR" \
    --docker-password="$CI_REGISTRY_PSW" \
    --docker-email=alessandro.neri@maggioli.it \
    -n "$NAMESPACE"
fi

# controlla se deve pushare certificato https
if [[ -f "$CI_MAGGIOLICLOUD_KEY" && -f "$CI_MAGGIOLICLOUD_CRT" ]]; then
  echo "Deploying TLS Secret <tls-secret>.."
  kubectl delete secret tls-secret -n "$NAMESPACE"
  kubectl create secret tls tls-secret \
    -n "$NAMESPACE" \
    --key "$CI_MAGGIOLICLOUD_KEY" \
    --cert "$CI_MAGGIOLICLOUD_CRT"
fi
