"""Picture upload for the trip logs. POST /log/<user>/upload with multipart field(s) "photo".

Each picture is kept as uploaded (orig/), resized for the page (photos/<id>.jpg, 2000 px) and for
the grid (photos/<id>.t.jpg, 800 px), with the time and place read from its EXIF. photos/index.json
lists them all and is what the page reads. Everything lives under DATA/<user>/, a volume shared
with the Caddy container that serves /log/<user>/photos/. No access control yet: the log pages are
unlisted, and the limits below bound what an upload can do.
"""
import email.parser
import email.policy
import hashlib
import io
import json
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image, ImageOps

try:
    import pillow_heif

    pillow_heif.register_heif_opener()
except ImportError:  # pragma: no cover
    pass

DATA = Path(os.environ.get("LOG_DATA", "/data"))
MAX_FILE = int(os.environ.get("LOG_MAX_FILE_MB", "40")) * 1024 * 1024
MAX_USER = int(os.environ.get("LOG_MAX_USER_GB", "5")) * 1024 * 1024 * 1024
USER_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,38}$")
LOCK = threading.Lock()
Image.MAX_IMAGE_PIXELS = 80_000_000


def _dms(v, ref):
    d, m, s = (float(x) for x in v)
    val = d + m / 60 + s / 3600
    return -val if ref in ("S", "W") else val


def exif_info(img: Image.Image) -> dict:
    out = {"taken": None, "lat": None, "lon": None, "alt": None}
    try:
        ex = img.getexif()
        sub = ex.get_ifd(0x8769)
        t = sub.get(36867) or sub.get(36868) or ex.get(306)
        if t and re.match(r"^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}", str(t)):
            t = str(t)
            out["taken"] = f"{t[0:4]}-{t[5:7]}-{t[8:10]}T{t[11:19]}"
        gps = ex.get_ifd(0x8825)
        if gps and 2 in gps and 4 in gps:
            out["lat"] = round(_dms(gps[2], gps.get(1, "N")), 6)
            out["lon"] = round(_dms(gps[4], gps.get(3, "E")), 6)
            if 6 in gps:
                out["alt"] = round(float(gps[6]) * (-1 if gps.get(5) == 1 else 1))
    except Exception:
        pass
    return out


def save_photo(user: str, name: str, data: bytes) -> dict:
    udir = DATA / user
    (udir / "orig").mkdir(parents=True, exist_ok=True)
    (udir / "photos").mkdir(parents=True, exist_ok=True)
    pid = hashlib.sha1(data).hexdigest()[:12]
    ext = (Path(name).suffix or ".jpg").lower()[:6]
    if not re.match(r"^\.[a-z0-9]+$", ext):
        ext = ".jpg"
    img = Image.open(io.BytesIO(data))
    info = exif_info(img)
    img = ImageOps.exif_transpose(img)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    (udir / "orig" / (pid + ext)).write_bytes(data)
    web = img.copy()
    web.thumbnail((2000, 2000), Image.LANCZOS)
    web.save(udir / "photos" / (pid + ".jpg"), "JPEG", quality=86, optimize=True, progressive=True)
    th = img.copy()
    th.thumbnail((800, 800), Image.LANCZOS)
    th.save(udir / "photos" / (pid + ".t.jpg"), "JPEG", quality=82, optimize=True)
    rec = {"id": pid, "file": pid + ".jpg", "thumb": pid + ".t.jpg", "orig": pid + ext, "w": web.width, "h": web.height, "name": Path(name).name[:80], **info}
    put_record(user, rec)
    return rec


def put_record(user: str, rec: dict) -> None:
    udir = DATA / user
    with LOCK:
        index_path = udir / "photos" / "index.json"
        index = json.loads(index_path.read_text()) if index_path.exists() else []
        index = [r for r in index if r.get("id") != rec["id"]] + [rec]
        index.sort(key=lambda r: (r.get("taken") or "9999", r["id"]))
        tmp = index_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(index, ensure_ascii=False, indent=0))
        tmp.replace(index_path)


def reindex(user: str) -> list:
    """Re-read time and place from every original (after a fix to the EXIF reading) and name the originals."""
    udir = DATA / user
    index_path = udir / "photos" / "index.json"
    index = json.loads(index_path.read_text()) if index_path.exists() else []
    out = []
    for rec in index:
        origs = list((udir / "orig").glob(rec["id"] + ".*"))
        if origs:
            rec["orig"] = origs[0].name
            try:
                img = Image.open(origs[0])
                info = exif_info(img)
                for k, v in info.items():
                    if v is not None:
                        rec[k] = v
            except Exception as e:  # keep the record, note the failure
                rec["error"] = str(e)[:80]
        put_record(user, rec)
        out.append(rec)
    return out


def used_bytes(user: str) -> int:
    d = DATA / user
    return sum(p.stat().st_size for p in d.rglob("*") if p.is_file()) if d.exists() else 0


class Handler(BaseHTTPRequestHandler):
    server_version = "trek-log-upload/1"

    def _json(self, code: int, body) -> None:
        raw = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, fmt, *args):  # one line per request, no client address
        print(fmt % args, flush=True)

    def do_GET(self):
        if self.path == "/healthz":
            return self._json(200, {"ok": True})
        self._json(405, {"error": "POST pictures to /log/<user>/upload"})

    def do_POST(self):
        m = re.match(r"^/log/([^/]+)/(upload|reindex)/?$", self.path.split("?")[0])
        if not m or not USER_RE.match(m.group(1)):
            return self._json(404, {"error": "unknown log"})
        user = m.group(1)
        if m.group(2) == "reindex":
            return self._json(200, reindex(user))
        length = int(self.headers.get("Content-Length") or 0)
        ctype = self.headers.get("Content-Type") or ""
        if length <= 0 or length > MAX_FILE * 4 or not ctype.startswith("multipart/form-data"):
            return self._json(400, {"error": "send multipart/form-data with picture files, under %d MB each" % (MAX_FILE // 1024 // 1024)})
        if used_bytes(user) > MAX_USER:
            return self._json(507, {"error": "this log's picture space is full"})
        body = self.rfile.read(length)
        msg = email.parser.BytesParser(policy=email.policy.HTTP).parsebytes(b"Content-Type: " + ctype.encode() + b"\r\nMIME-Version: 1.0\r\n\r\n" + body)
        out, errors = [], []
        for part in msg.iter_parts() if msg.is_multipart() else []:
            name = part.get_filename()
            data = part.get_payload(decode=True)
            if not name or not data:
                continue
            if len(data) > MAX_FILE:
                errors.append({"name": name, "error": "too large"})
                continue
            try:
                out.append(save_photo(user, name, data))
            except Exception as e:  # a bad file must not stop the others
                errors.append({"name": name, "error": str(e)[:120]})
        if not out and errors:
            return self._json(422, {"error": "no picture could be read", "details": errors})
        self._json(200, out)


if __name__ == "__main__":
    DATA.mkdir(parents=True, exist_ok=True)
    port = int(os.environ.get("PORT", "8080"))
    print(f"trek log upload on :{port}, data in {DATA}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
