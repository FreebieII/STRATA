#!/bin/sh
# Make the HTTPS certificate for the STRATA dashboard.
#
#   scripts/make-dashboard-cert.sh                  this machine's names and LAN addresses
#   scripts/make-dashboard-cert.sh 192.168.1.50     ...plus extra addresses or names
#   scripts/make-dashboard-cert.sh --new-ca         start again with a new local CA
#
# The first run creates a small certificate authority (CA) of your own in
# certs/. Install certs/strata-local-ca.crt on each device that opens the
# dashboard, once; after that browsers trust the dashboard without warnings.
#
# The CA can only vouch for home-network names (localhost, this machine's
# name, *.local, *.lan, *.home.arpa, *.internal) and private addresses
# (127.x, 10.x, 172.16-31.x, 192.168.x). Devices that trust it therefore
# can't be fooled about any other website, even if its key were stolen.
#
# Every later run keeps the CA and only issues a fresh dashboard certificate,
# for example after the machine gets a new address. Certificates last 397
# days; run this again before then. Then restart the dashboard:
#     docker compose up -d --force-recreate frontend
#
# Run it as your normal user, not with sudo: the dashboard container reads
# the key as you.

set -eu

CERT_DAYS=397
CA_DAYS=1825
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DIR=${STRATA_CERTS_DIR:-"$(dirname -- "$HERE")/certs"}

fail() {
    echo "make-dashboard-cert: $*" >&2
    exit 2
}


new_ca=no
extras=""
for arg in "$@"; do
    case "$arg" in
        --new-ca) new_ca=yes ;;
        -h | --help)
            sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        -*) fail "unknown option $arg (try --help)" ;;
        *) extras="$extras $arg" ;;
    esac
done

command -v openssl >/dev/null 2>&1 || fail "openssl is not installed (Debian: sudo apt install openssl)"
[ "$(id -u)" -ne 0 ] || echo "warning: running as root; the dashboard container may not be able to read the key" >&2

# --- which names and addresses ---------------------------------------------------

is_private_ipv4() {
    # shellcheck disable=SC2046
    set -- $(echo "$1" | tr '.' ' ')
    [ $# -eq 4 ] || return 1
    for octet in "$@"; do
        case "$octet" in '' | *[!0-9]*) return 1 ;; esac
        [ "$octet" -le 255 ] || return 1
    done
    [ "$1" -eq 10 ] && return 0
    [ "$1" -eq 127 ] && return 0
    [ "$1" -eq 172 ] && [ "$2" -ge 16 ] && [ "$2" -le 31 ] && return 0
    [ "$1" -eq 192 ] && [ "$2" -eq 168 ] && return 0
    return 1
}

is_allowed_name() {
    name=$1
    case "$name" in
        localhost | "$HOST" | *.local | *.lan | *.home.arpa | *.internal | *."$HOST") return 0 ;;
    esac
    return 1
}

HOST=$(hostname -s 2>/dev/null || hostname)
HOST=$(echo "$HOST" | tr '[:upper:]' '[:lower:]')
case "$HOST" in
    '' | *[!a-z0-9-]*) fail "this machine's name ($HOST) can't be used in a certificate" ;;
esac

names="localhost $HOST $HOST.local"
addresses="127.0.0.1"

# This machine's LAN addresses, leaving out Docker's and VMs' own networks.
if command -v ip >/dev/null 2>&1; then
    found=$(ip -o -4 addr show scope global 2>/dev/null |
        awk '$2 !~ /^(docker|br-|veth|virbr|lxc|cni|flannel|tailscale|wg)/ { split($4, a, "/"); print a[1] }')
else
    found=$(hostname -I 2>/dev/null || true)
fi
for address in $found; do
    if is_private_ipv4 "$address"; then addresses="$addresses $address"; fi
done

for extra in $extras; do
    extra=$(echo "$extra" | tr '[:upper:]' '[:lower:]')
    case "$extra" in
        *[!0-9.]*)
            is_allowed_name "$extra" ||
                fail "$extra: only localhost, $HOST, and names ending in .local, .lan, .home.arpa or .internal can be used"
            names="$names $extra"
            ;;
        *)
            is_private_ipv4 "$extra" ||
                fail "$extra is not a private (home network) address; the dashboard must never face the internet"
            addresses="$addresses $extra"
            ;;
    esac
done

dedupe() { printf '%s\n' $1 | awk 'NF && !seen[$0]++' | tr '\n' ' ' | sed 's/ $//'; }
names=$(dedupe "$names")
addresses=$(dedupe "$addresses")

# --- files ---------------------------------------------------------------------------

umask 077
mkdir -p "$DIR"
chmod 700 "$DIR"
CA_KEY="$DIR/strata-local-ca.key"
CA_CRT="$DIR/strata-local-ca.crt"
KEY="$DIR/dashboard.key"
CRT="$DIR/dashboard.crt"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT INT TERM

if [ "$new_ca" = yes ] || [ ! -s "$CA_KEY" ] || [ ! -s "$CA_CRT" ]; then
    cat >"$WORK/ca.cnf" <<EOF
[ req ]
distinguished_name = dn
prompt = no
[ dn ]
O = STRATA
CN = STRATA local CA ($HOST)
[ ca ]
basicConstraints = critical, CA:true, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
nameConstraints = critical, permitted;DNS:localhost, permitted;DNS:$HOST, permitted;DNS:local, permitted;DNS:lan, permitted;DNS:home.arpa, permitted;DNS:internal, permitted;IP:127.0.0.0/255.0.0.0, permitted;IP:10.0.0.0/255.0.0.0, permitted;IP:172.16.0.0/255.240.0.0, permitted;IP:192.168.0.0/255.255.0.0
EOF
    openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$CA_KEY" 2>/dev/null
    openssl req -new -x509 -key "$CA_KEY" -sha256 -days "$CA_DAYS" \
        -config "$WORK/ca.cnf" -extensions ca -out "$CA_CRT"
    chmod 600 "$CA_KEY"
    chmod 644 "$CA_CRT"
    echo "Created a new local CA: $CA_CRT"
    echo "  Install it on every device that opens the dashboard (see docs/DEPLOYMENT.md)."
else
    echo "Using the existing local CA: $CA_CRT"
fi

{
    echo "[ req ]"
    echo "distinguished_name = dn"
    echo "prompt = no"
    echo "[ dn ]"
    echo "O = STRATA"
    echo "CN = $HOST"
    echo "[ server ]"
    echo "basicConstraints = critical, CA:false"
    echo "keyUsage = critical, digitalSignature"
    echo "extendedKeyUsage = serverAuth"
    echo "subjectKeyIdentifier = hash"
    echo "authorityKeyIdentifier = keyid:always"
    echo "subjectAltName = @names"
    echo "[ names ]"
    i=1
    for name in $names; do
        echo "DNS.$i = $name"
        i=$((i + 1))
    done
    i=1
    for address in $addresses; do
        echo "IP.$i = $address"
        i=$((i + 1))
    done
} >"$WORK/server.cnf"

openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$WORK/dashboard.key" 2>/dev/null
openssl req -new -key "$WORK/dashboard.key" -config "$WORK/server.cnf" -out "$WORK/dashboard.csr"
openssl x509 -req -in "$WORK/dashboard.csr" -CA "$CA_CRT" -CAkey "$CA_KEY" \
    -set_serial "0x$(openssl rand -hex 16)" -days "$CERT_DAYS" -sha256 \
    -extfile "$WORK/server.cnf" -extensions server -out "$WORK/dashboard.crt" 2>/dev/null
openssl verify -CAfile "$CA_CRT" "$WORK/dashboard.crt" >/dev/null ||
    fail "the new certificate doesn't check out against the CA; nothing was changed"

mv -f "$WORK/dashboard.key" "$KEY"
mv -f "$WORK/dashboard.crt" "$CRT"
chmod 600 "$KEY"
chmod 644 "$CRT"

echo
echo "Dashboard certificate: $CRT"
echo "  valid until: $(openssl x509 -in "$CRT" -noout -enddate | cut -d= -f2)"
echo "  names:       $names"
echo "  addresses:   $addresses"
echo
echo "Local CA fingerprint (check it matches on each device you install it on):"
echo "  $(openssl x509 -in "$CA_CRT" -noout -fingerprint -sha256 | cut -d= -f2)"
echo
echo "Next: docker compose up -d --force-recreate frontend"
