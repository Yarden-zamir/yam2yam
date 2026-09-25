"""Picture upload and page edits for the trip logs. POST /log/<user>/upload with multipart field(s) "photo";
POST /log/<user>/edit with a JSON edit (a day's text, a picture's caption or hidden flag), kept in
photos/edits.json which the page reads on load.

Each picture is kept as uploaded (orig/), resized for the page (photos/<id>.jpg, 2000 px), for the
grid (photos/<id>.t.jpg, 800 px) and for the map dots (photos/<id>.s.jpg, a 200 px square), with the time and place read from its EXIF. photos/index.json
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
import time
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
EDIT_KEY = os.environ.get("LOG_EDIT_KEY", "")  # when set, edits need this key (X-Log-Key); uploads stay open
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


def load_index(user: str) -> list:
    index_path = DATA / user / "photos" / "index.json"
    return json.loads(index_path.read_text()) if index_path.exists() else []


def save_photo(user: str, name: str, data: bytes, fields: dict | None = None) -> dict:
    udir = DATA / user
    (udir / "orig").mkdir(parents=True, exist_ok=True)
    (udir / "photos").mkdir(parents=True, exist_ok=True)
    pid = hashlib.sha1(data).hexdigest()[:12]
    ext = (Path(name).suffix or ".jpg").lower()[:6]
    if not re.match(r"^\.[a-z0-9]+$", ext):
        ext = ".jpg"
    img = Image.open(io.BytesIO(data))
    info = exif_info(img)
    for k in ("taken", "lat", "lon", "alt"):  # a sidecar or the page may know what the picture itself lost
        v = (fields or {}).get(k)
        if info.get(k) is None and v not in (None, ""):
            try:
                info[k] = v if k == "taken" else round(float(v), 6 if k != "alt" else 0)
            except ValueError:
                pass
    if info.get("taken") and not re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$", str(info["taken"])):
        info["taken"] = None
    img = ImageOps.exif_transpose(img)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    # the same shot uploaded again (same second, same shape) keeps its id, so the log's references hold
    if info.get("taken"):
        for old in load_index(user):
            if old.get("taken") == info["taken"] and old.get("w") == min(img.width, 2000 * img.width // max(img.width, img.height)) and old.get("h") == min(img.height, 2000 * img.height // max(img.width, img.height)):
                pid = old["id"]
                for stale in (udir / "orig").glob(pid + ".*"):
                    stale.unlink()
                break
    (udir / "orig" / (pid + ext)).write_bytes(data)
    web = img.copy()
    web.thumbnail((2000, 2000), Image.LANCZOS)
    web.save(udir / "photos" / (pid + ".jpg"), "JPEG", quality=86, optimize=True, progressive=True)
    th = img.copy()
    th.thumbnail((800, 800), Image.LANCZOS)
    th.save(udir / "photos" / (pid + ".t.jpg"), "JPEG", quality=82, optimize=True)
    small_preview(img, udir / "photos" / (pid + ".s.jpg"))
    rec = {"id": pid, "file": pid + ".jpg", "thumb": pid + ".t.jpg", "small": pid + ".s.jpg", "orig": pid + ext, "w": web.width, "h": web.height, "name": Path(name).name[:80], **info}
    put_record(user, rec)
    return rec


def small_preview(img: Image.Image, path: Path) -> None:
    """The map's preview: the middle square of the picture, 200 px, a few KB."""
    side = min(img.width, img.height)
    sq = img.crop(((img.width - side) // 2, (img.height - side) // 2, (img.width - side) // 2 + side, (img.height - side) // 2 + side))
    sq.thumbnail((200, 200), Image.LANCZOS)
    sq.save(path, "JPEG", quality=78, optimize=True)


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
    """Re-read time and place from every original (after a fix to the EXIF reading), name the originals,
    and make the small map preview where it is missing."""
    udir = DATA / user
    index_path = udir / "photos" / "index.json"
    index = json.loads(index_path.read_text()) if index_path.exists() else []
    out = []
    for rec in index:
        small = udir / "photos" / (rec["id"] + ".s.jpg")
        if not small.exists() and (udir / "photos" / rec["file"]).exists():
            try:
                small_preview(Image.open(udir / "photos" / rec["file"]), small)
            except Exception as e:  # keep the record, note the failure
                rec["error"] = str(e)[:80]
        if small.exists():
            rec["small"] = small.name
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


def edits_path(user: str) -> Path:
    return DATA / user / "photos" / "edits.json"


def load_edits(user: str) -> dict:
    p = edits_path(user)
    e = json.loads(p.read_text()) if p.exists() else {}
    e.setdefault("days", {})
    e.setdefault("photos", {})
    return e


def apply_edit(user: str, body: dict) -> dict:
    """Edits made on the page, kept beside the pictures and read by the page on load: a day's text
    per language, a day's tips, the intro, the outro or a reference section per language, a picture's
    caption or whether it is hidden, the cover picture (an id, null to remove it). tools/log_pull.py folds them into log.yaml."""
    with LOCK:
        e = load_edits(user)
        if "day" in body:
            d = e["days"].setdefault(str(int(body["day"])), {})
            for field in ("text", "tips"):
                for lang, paras in (body.get(field) or {}).items():
                    if re.match(r"^[a-z]{2}$", str(lang)) and isinstance(paras, list):
                        d.setdefault(field, {})[lang] = [str(x)[:20000] for x in paras][:200]
        if body.get("section"):
            key = str(body["section"])
            if not re.match(r"^[a-z][a-z0-9-]{0,30}$", key):
                raise ValueError("bad section")
            sec = e.setdefault(key, {}) if key in ("intro", "outro") else e.setdefault("sections", {}).setdefault(key, {})
            for lang, paras in (body.get("text") or {}).items():
                if re.match(r"^[a-z]{2}$", str(lang)) and isinstance(paras, list):
                    sec[lang] = [str(x)[:20000] for x in paras][:200]
        if "photo" in body:
            pid = str(body["photo"])
            if not re.match(r"^[a-f0-9]{12}$", pid):
                raise ValueError("bad picture id")
            p = e["photos"].setdefault(pid, {})
            if "hide" in body:
                p["hide"] = bool(body["hide"])
            if isinstance(body.get("caption"), dict):
                p.setdefault("caption", {}).update({str(k): str(v)[:500] for k, v in body["caption"].items() if re.match(r"^[a-z]{2}$", str(k))})
        if "cover" in body:
            c = body["cover"]
            if c in (None, ""):
                e["cover"] = None
            elif re.match(r"^[a-f0-9]{12}$", str(c)):
                e["cover"] = str(c)
            else:
                raise ValueError("bad picture id")
        e["updated"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        path = edits_path(user)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(e, ensure_ascii=False, indent=0))
        tmp.replace(path)
        return e


OG_MAX = 290_000  # WhatsApp shows no preview above about 300 KB


def og_preview(user: str, pid: str, y: int | None) -> Path | None:
    """A 1200 x 630 crop of the picture for link previews (og:image), centred on y percent of its height,
    made on the first request and kept beside the picture. None when the picture is unknown."""
    src = DATA / user / "photos" / (pid + ".jpg")
    if not src.exists():
        return None
    out = DATA / user / "photos" / (pid + (f".og{y}.jpg" if y is not None else ".og.jpg"))
    if out.exists() and out.stat().st_mtime >= src.stat().st_mtime:
        return out
    img = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
    W, H = 1200, 630
    scale = max(W / img.width, H / img.height)
    img = img.resize((max(W, round(img.width * scale)), max(H, round(img.height * scale))), Image.LANCZOS)
    cy = img.height * (y if y is not None else 50) / 100
    top = int(min(max(cy - H / 2, 0), img.height - H))
    left = (img.width - W) // 2
    img = img.crop((left, top, left + W, top + H))
    q = 80
    while True:
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=q, optimize=True, progressive=True)
        if buf.tell() <= OG_MAX or q <= 40:
            break
        q -= 8
    tmp = out.with_suffix(".tmp")
    tmp.write_bytes(buf.getvalue())
    tmp.replace(out)
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

    def do_HEAD(self):  # link crawlers ask HEAD before GET
        self.do_GET(head=True)

    def do_GET(self, head: bool = False):
        if self.path == "/healthz":
            return self._json(200, {"ok": True})
        path, _, query = self.path.partition("?")
        m = re.match(r"^/log/([^/]+)/photos/([a-f0-9]{12})\.og\.jpg$", path)
        if m:  # the link-preview crop, made on demand
            y = re.search(r"(?:^|&)y=(\d{1,3})", query)
            out = og_preview(m.group(1), m.group(2), min(100, int(y.group(1))) if y else None)
            if not out:
                return self._json(404, {"error": "no such picture"})
            raw = out.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "public, max-age=86400")
            self.end_headers()
            if not head:
                self.wfile.write(raw)
            return
        self._json(405, {"error": "POST pictures to /log/<user>/upload"})

    def do_POST(self):
        m = re.match(r"^/log/([^/]+)/(upload|reindex|edit)/?$", self.path.split("?")[0])
        if not m or not USER_RE.match(m.group(1)):
            return self._json(404, {"error": "unknown log"})
        user = m.group(1)
        if m.group(2) == "reindex":
            return self._json(200, reindex(user))
        if m.group(2) == "edit":
            if EDIT_KEY and self.headers.get("X-Log-Key", "") != EDIT_KEY:
                return self._json(403, {"error": "edit key needed"})
            n = int(self.headers.get("Content-Length") or 0)
            if n <= 0 or n > 2_000_000:
                return self._json(400, {"error": "send a JSON edit"})
            try:
                return self._json(200, apply_edit(user, json.loads(self.rfile.read(n).decode("utf-8"))))
            except (ValueError, TypeError, KeyError) as e:
                return self._json(400, {"error": str(e)[:120]})
        length = int(self.headers.get("Content-Length") or 0)
        ctype = self.headers.get("Content-Type") or ""
        if length <= 0 or length > MAX_FILE * 4 or not ctype.startswith("multipart/form-data"):
            return self._json(400, {"error": "send multipart/form-data with picture files, under %d MB each" % (MAX_FILE // 1024 // 1024)})
        if used_bytes(user) > MAX_USER:
            return self._json(507, {"error": "this log's picture space is full"})
        body = self.rfile.read(length)
        msg = email.parser.BytesParser(policy=email.policy.HTTP).parsebytes(b"Content-Type: " + ctype.encode() + b"\r\nMIME-Version: 1.0\r\n\r\n" + body)
        out, errors, fields = [], [], {}
        parts = list(msg.iter_parts()) if msg.is_multipart() else []
        for part in parts:  # plain fields first: they apply to the pictures in the same request
            if not part.get_filename() and part.get_param("name", header="content-disposition"):
                fields[str(part.get_param("name", header="content-disposition"))] = (part.get_payload(decode=True) or b"").decode("utf-8", "replace").strip()
        for part in parts:
            name = part.get_filename()
            data = part.get_payload(decode=True)
            if not name or not data:
                continue
            if len(data) > MAX_FILE:
                errors.append({"name": name, "error": "too large"})
                continue
            try:
                out.append(save_photo(user, name, data, fields))
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
