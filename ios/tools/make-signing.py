#!/usr/bin/env python3
"""Create an Apple Distribution certificate and an App Store provisioning profile with an
App Store Connect API key, and write them as files for the GitHub secrets used by ios.yml.

    pip install pyjwt cryptography
    python3 make-signing.py KEY_ID ISSUER_ID AuthKey_KEY_ID.p8 OUT_DIR [BUNDLE_ID]

OUT_DIR gets dist.p12 + dist.p12.password (DIST_CERT_P12 base64 / DIST_CERT_PASSWORD),
profile.mobileprovision (PROFILE_B64 base64), dist-key.pem, dist.cer and ids.json.
Keep OUT_DIR private. A team can hold only a few distribution certificates; revoke old ones
in the developer portal before making a new one. Both expire after a year.
"""
import base64, json, os, secrets, sys, time, urllib.error, urllib.request

import jwt
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

KID, ISS, P8, OUT = sys.argv[1:5]
BUNDLE = sys.argv[5] if len(sys.argv) > 5 else "xyz.tunapro.hackertune"


def api(method, path, body=None):
    now = int(time.time())
    tok = jwt.encode({"iss": ISS, "iat": now, "exp": now + 600, "aud": "appstoreconnect-v1"}, open(P8).read(),
                     algorithm="ES256", headers={"kid": KID, "typ": "JWT"})
    req = urllib.request.Request("https://api.appstoreconnect.apple.com" + path, method=method,
                                 data=json.dumps(body).encode() if body else None,
                                 headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req, timeout=30))
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path}: HTTP {e.code} {e.read().decode()[:500]}")


os.makedirs(OUT, mode=0o700, exist_ok=True)
os.umask(0o077)
key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
csr = x509.CertificateSigningRequestBuilder().subject_name(
    x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "HackerTune CI")])).sign(key, hashes.SHA256())
c = api("POST", "/v1/certificates", {"data": {"type": "certificates", "attributes": {
    "certificateType": "DISTRIBUTION", "csrContent": csr.public_bytes(serialization.Encoding.PEM).decode()}}})["data"]
cert = x509.load_der_x509_certificate(base64.b64decode(c["attributes"]["certificateContent"]))
print("certificate", c["id"], cert.subject.rfc4514_string())

bid = next(b["id"] for b in api("GET", f"/v1/bundleIds?filter[identifier]={BUNDLE}")["data"]
           if b["attributes"]["identifier"] == BUNDLE)
name = f"{BUNDLE} App Store {c['id']}"
p = api("POST", "/v1/profiles", {"data": {"type": "profiles", "attributes": {"name": name, "profileType": "IOS_APP_STORE"},
        "relationships": {"bundleId": {"data": {"type": "bundleIds", "id": bid}},
                          "certificates": {"data": [{"type": "certificates", "id": c["id"]}]}}}})["data"]
print("profile", p["id"], name)

pw = secrets.token_urlsafe(24)
# macOS `security import` cannot read OpenSSL 3's default AES p12, so use the legacy 3DES/SHA1 format.
enc = (serialization.PrivateFormat.PKCS12.encryption_builder().kdf_rounds(50000)
       .key_cert_algorithm(pkcs12.PBES.PBESv1SHA1And3KeyTripleDESCBC).hmac_hash(hashes.SHA1()).build(pw.encode()))
files = {
    "dist.p12": pkcs12.serialize_key_and_certificates(b"HackerTune Distribution", key, cert, None, enc),
    "dist.p12.password": pw.encode(),
    "dist-key.pem": key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                      serialization.NoEncryption()),
    "dist.cer": cert.public_bytes(serialization.Encoding.DER),
    "profile.mobileprovision": base64.b64decode(p["attributes"]["profileContent"]),
    "ids.json": json.dumps({"certificate_id": c["id"], "profile_id": p["id"], "profile_name": name}).encode(),
}
for fn, data in files.items():
    with open(os.path.join(OUT, fn), "wb") as f:
        f.write(data)
print("written to", OUT)
