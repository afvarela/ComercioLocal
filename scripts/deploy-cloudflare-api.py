"""Publica el Worker sin depender del proceso hijo de esbuild de Wrangler.

Conserva los archivos web ya publicados, aplica la migración de logística en D1
y actualiza únicamente los módulos del Worker y sus bindings.
"""
from __future__ import annotations

import datetime as dt
import base64
import json
import mimetypes
import os
import pathlib
import re
import secrets
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONFIG = ROOT / "cloudflare" / "wrangler.jsonc"
AUTH = pathlib.Path(os.environ["APPDATA"]) / "xdg.config" / ".wrangler" / "config" / "default.toml"
API = "https://api.cloudflare.com/client/v4"
TOKEN_URL = "https://dash.cloudflare.com/oauth2/token"
CLIENT_ID = "54d11594-84e4-41aa-b438-e81b8fa78ee7"


def api_request(url: str, token: str, method: str = "GET", body: bytes | None = None, content_type: str = "application/json"):
    request = urllib.request.Request(url, data=body, method=method)
    request.add_header("Authorization", f"Bearer {token}")
    if body is not None:
        request.add_header("Content-Type", content_type)
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            raw = response.read()
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            detail = json.loads(raw).get("errors") or json.loads(raw)
        except Exception:
            detail = raw.decode("utf-8", "replace")[:1000]
        raise RuntimeError(f"Cloudflare respondió HTTP {error.code}: {detail}") from None
    data = json.loads(raw)
    if not data.get("success", True):
        raise RuntimeError(f"Cloudflare rechazó la operación: {data.get('errors')}")
    return data


def save_oauth(stored: dict, renewed: dict) -> str:
    expiration = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=int(renewed.get("expires_in", 3600)))).isoformat().replace("+00:00", "Z")
    updates = {
        "oauth_token": renewed["access_token"],
        "expiration_time": expiration,
        "refresh_token": renewed.get("refresh_token", stored.get("refresh_token", "")),
        "scopes": renewed.get("scope", " ".join(stored.get("scopes", []))).split(),
    }
    text = AUTH.read_text(encoding="utf-8")
    for key, value in updates.items():
        encoded = json.dumps(value, ensure_ascii=False)
        pattern = rf"(?m)^{re.escape(key)}\s*=.*$"
        text, count = re.subn(pattern, f"{key} = {encoded}", text)
        if not count:
            text += f"\n{key} = {encoded}"
    AUTH.write_text(text.rstrip() + "\n", encoding="utf-8")
    return renewed["access_token"]


def device_oauth(stored: dict) -> dict:
    scopes = [*stored.get("scopes", []), "offline_access"]
    payload = urllib.parse.urlencode({"client_id": CLIENT_ID, "scope": " ".join(dict.fromkeys(scopes))}).encode()
    request = urllib.request.Request("https://dash.cloudflare.com/oauth2/device/auth", data=payload, method="POST")
    request.add_header("Content-Type", "application/x-www-form-urlencoded")
    request.add_header("User-Agent", "wrangler/4.133.0")
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            grant = json.loads(response.read())
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:300]
        raise RuntimeError(f"No fue posible iniciar la autorización de Cloudflare (HTTP {error.code}: {detail})") from None
    verify = grant.get("verification_uri_complete") or f"{grant['verification_uri']}?user_code={urllib.parse.quote(grant['user_code'])}"
    print("AUTORIZAR_URL: " + verify, flush=True)
    deadline = time.time() + min(int(grant.get("expires_in", 600)), 600)
    interval = max(3, int(grant.get("interval", 5)))
    token_payload = {
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
        "device_code": grant["device_code"],
        "client_id": CLIENT_ID,
    }
    while time.time() < deadline:
        time.sleep(interval)
        request = urllib.request.Request(TOKEN_URL, data=urllib.parse.urlencode(token_payload).encode(), method="POST")
        request.add_header("Content-Type", "application/x-www-form-urlencoded")
        request.add_header("User-Agent", "wrangler/4.133.0")
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                raw = response.read()
        except urllib.error.HTTPError as error:
            raw = error.read()
        try:
            answer = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            answer = {"error": "authorization_pending"}
        if answer.get("access_token"):
            return answer
        if answer.get("error") == "slow_down":
            interval += 5
        elif answer.get("error") not in {"authorization_pending", "slow_down"}:
            raise RuntimeError(f"Cloudflare no autorizó el acceso: {answer.get('error_description') or answer.get('error')}")
    raise RuntimeError("La autorización de Cloudflare venció antes de completarse.")


def refresh_oauth() -> str:
    import tomllib

    stored = tomllib.loads(AUTH.read_text(encoding="utf-8"))
    expiry_text = str(stored.get("expiration_time", "")).replace("Z", "+00:00")
    try:
        expiry = dt.datetime.fromisoformat(expiry_text)
    except ValueError:
        expiry = dt.datetime.min.replace(tzinfo=dt.timezone.utc)
    if stored.get("oauth_token") and expiry > dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=2):
        return stored["oauth_token"]
    payload = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "refresh_token": stored["refresh_token"],
        "client_id": CLIENT_ID,
    }).encode()
    request = urllib.request.Request(TOKEN_URL, data=payload, method="POST")
    request.add_header("Content-Type", "application/x-www-form-urlencoded")
    request.add_header("User-Agent", "wrangler/4.133.0")
    renewed = None
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            renewed = json.loads(response.read())
    except urllib.error.HTTPError:
        renewed = device_oauth(stored)
    if not renewed.get("access_token"):
        raise RuntimeError(f"Cloudflare no renovó la sesión: {renewed.get('error', 'respuesta inválida')}")
    return save_oauth(stored, renewed)


def statements(sql: str):
    current = ""
    for line in sql.splitlines(True):
        current += line
        if sqlite3.complete_statement(current):
            if current.strip():
                yield current.strip()
            current = ""
    if current.strip():
        yield current.strip()


def apply_logistics_migration(token: str, account: str, database: str):
    url = f"{API}/accounts/{account}/d1/database/{database}/query"
    sql = (ROOT / "cloudflare" / "migrations" / "0010_logistics.sql").read_text(encoding="utf-8")
    for statement in statements(sql):
        api_request(url, token, "POST", json.dumps({"sql": statement}).encode())


def multipart(metadata: dict, modules: list[pathlib.Path]):
    boundary = "----ComercioLocal" + secrets.token_hex(16)
    chunks: list[bytes] = []

    def add(name: str, content: bytes, content_type: str, filename: str | None = None):
        disposition = f'form-data; name="{name}"' + (f'; filename="{filename}"' if filename else "")
        chunks.extend([
            f"--{boundary}\r\n".encode(),
            f"Content-Disposition: {disposition}\r\n".encode(),
            f"Content-Type: {content_type}\r\n\r\n".encode(),
            content,
            b"\r\n",
        ])

    add("metadata", json.dumps(metadata, ensure_ascii=False).encode(), "application/json")
    for module in modules:
        add(module.name, module.read_bytes(), "application/javascript+module", module.name)
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def asset_manifest() -> dict:
    node = os.environ.get("COMERCIO_NODE") or shutil.which("node")
    if not node:
        bundled = pathlib.Path.home() / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies" / "node" / "bin" / "node.exe"
        node = str(bundled) if bundled.exists() else ""
    if not node:
        raise RuntimeError("No se encontro Node.js para preparar los archivos web.")
    output = subprocess.check_output(
        [node, str(ROOT / "scripts" / "assets-manifest.mjs"), str(ROOT / "public")],
        cwd=ROOT,
        text=True,
        encoding="utf-8",
    )
    return json.loads(output)


def jwt_payload(token: str) -> dict:
    try:
        encoded = token.split(".")[1]
        encoded += "=" * (-len(encoded) % 4)
        return json.loads(base64.urlsafe_b64decode(encoded))
    except Exception:
        return {}


def asset_upload_body(entries: list[tuple[str, pathlib.Path]]):
    boundary = "----ComercioAssets" + secrets.token_hex(16)
    chunks: list[bytes] = []
    for digest, source in entries:
        content_type = mimetypes.guess_type(source.name)[0] or "application/null"
        chunks.extend([
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="{digest}"; filename="{digest}"\r\n'.encode(),
            f"Content-Type: {content_type}\r\n\r\n".encode(),
            base64.b64encode(source.read_bytes()),
            b"\r\n",
        ])
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def sync_assets(token: str, config: dict) -> str:
    manifest = asset_manifest()
    account = config["account_id"]
    script = config["name"]
    session_url = f"{API}/accounts/{account}/workers/scripts/{script}/assets-upload-session"
    initialized = api_request(session_url, token, "POST", json.dumps({"manifest": manifest}).encode())["result"]
    upload_token = initialized.get("jwt")
    if not upload_token:
        raise RuntimeError("Cloudflare no devolvio el token para publicar los archivos web.")
    by_hash = {details["hash"]: ROOT / "public" / route.lstrip("/") for route, details in manifest.items()}
    buckets = initialized.get("buckets") or []
    completion = upload_token
    single = jwt_payload(upload_token).get("wrangler_single_asset_uploads") is True
    for bucket in buckets:
        if single:
            for digest in bucket:
                source = by_hash[digest]
                content_type = mimetypes.guess_type(source.name)[0] or "application/null"
                url = f"{API}/accounts/{account}/workers/assets/upload/{digest}"
                answer = api_request(url, upload_token, "POST", source.read_bytes(), content_type)["result"]
                completion = answer.get("jwt") or completion
        elif bucket:
            entries = [(digest, by_hash[digest]) for digest in bucket]
            body, content_type = asset_upload_body(entries)
            url = f"{API}/accounts/{account}/workers/assets/upload?base64=true"
            answer = api_request(url, upload_token, "POST", body, content_type)["result"]
            completion = answer.get("jwt") or completion
    return completion


def deploy_worker(token: str, config: dict, assets_jwt: str):
    modules = sorted((ROOT / "cloudflare").glob("*.mjs"))
    d1 = config["d1_databases"][0]
    r2 = config["r2_buckets"][0]
    metadata = {
        "main_module": "worker.mjs",
        "compatibility_date": config["compatibility_date"],
        "compatibility_flags": config.get("compatibility_flags", []),
        "assets": {"jwt": assets_jwt, "config": {"run_worker_first": True}},
        "bindings": [
            {"type": "assets", "name": config["assets"]["binding"]},
            {"type": "d1", "name": d1["binding"], "id": d1["database_id"]},
            {"type": "r2_bucket", "name": r2["binding"], "bucket_name": r2["bucket_name"]},
        ],
        "observability": config.get("observability", {"enabled": True}),
        "annotations": {"workers/message": "Corrige fecha Colombia en ventas y reportes"},
    }
    body, content_type = multipart(metadata, modules)
    url = f"{API}/accounts/{config['account_id']}/workers/scripts/{config['name']}"
    return api_request(url, token, "PUT", body, content_type)


def verify_worker(token: str, config: dict):
    url = f"{API}/accounts/{config['account_id']}/workers/scripts/{config['name']}/content/v2"
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(request, timeout=60) as response:
        content = response.read()
    for required in (
        b"version:'3.3.2'",
        b"typeof db.one==='function'",
        b"width=/width:72mm/.test(source)?38:28",
        b"date(s.created,'-5 hours')",
    ):
        if required not in content:
            raise RuntimeError(f"El Worker publicado no contiene la corrección esperada: {required.decode()}")


def main():
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    token = refresh_oauth()
    print("Sesión de Cloudflare renovada.")
    apply_logistics_migration(token, config["account_id"], config["d1_databases"][0]["database_id"])
    print("Tablas de despachos verificadas en D1.")
    assets_jwt = sync_assets(token, config)
    print("Archivos web sincronizados.")
    deploy_worker(token, config, assets_jwt)
    print("Worker de logística publicado.")
    public_url = (ROOT / "cloudflare" / "deployment-url.txt").read_text(encoding="utf-8").strip()
    verify_worker(token, config)
    print(f"Publicación verificada: {public_url}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
