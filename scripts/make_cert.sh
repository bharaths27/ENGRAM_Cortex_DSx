#!/usr/bin/env bash
# Local certificate authority + server cert so iPad Safari treats the console as a
# secure context (required for microphone access). Works fully offline.
# Usage: ./scripts/make_cert.sh [extra-ip-or-hostname ...]
set -e
cd "$(dirname "$0")/../certs"
IPS=$(hostname -I 2>/dev/null || { ipconfig getifaddr en0 2>/dev/null; ipconfig getifaddr en1 2>/dev/null; } || true)
H=$(hostname -s 2>/dev/null || hostname)
NAMES="localhost $H $H.local 10.42.0.1 $IPS $*"
SAN=""; i=1; j=1
for n in $NAMES; do
  if [[ $n =~ ^[0-9.]+$ ]]; then SAN="$SAN,IP.$i:$n"; i=$((i+1)); else SAN="$SAN,DNS.$j:$n"; j=$((j+1)); fi
done
SAN="${SAN#,}"
[ -f engram-ca.key ] || openssl req -x509 -newkey rsa:2048 -nodes -days 825 -keyout engram-ca.key -out engram-ca.crt -subj "/CN=ENGRAM Local CA"
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=engram-console"
printf "subjectAltName=%s\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n" "$SAN" > san.ext
openssl x509 -req -in server.csr -CA engram-ca.crt -CAkey engram-ca.key -CAcreateserial -out server.crt -days 397 -sha256 -extfile san.ext
rm -f server.csr san.ext
echo "Cert covers: $SAN"
echo "On the iPad: open http://<pi-ip>:8000/ca.crt, install the profile, then"
echo "Settings > General > About > Certificate Trust Settings > enable 'ENGRAM Local CA'."
