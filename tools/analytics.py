# /// script
# requires-python = ">=3.11"
# dependencies = ["requests"]
# ///
"""Google Analytics for the site: register the page's event parameters, and print the reports.

  uv run tools/analytics.py setup            # once per property: the custom dimensions that site/analytics.js fills
  uv run tools/analytics.py report [--days 28]
  uv run tools/analytics.py live               # the last 30 minutes: users and events (reports lag up to a day)

The property is the one whose web stream has the measurement id in trek.json ("analytics").
Access goes through a service account that is an Editor on the Analytics account. gcloud makes the token:
GA_SERVICE_ACCOUNT is the service account to impersonate, and GA_GCLOUD_ACCOUNT (optional) is the gcloud
login that may impersonate it. No key file is needed.
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
TREK = json.loads((ROOT / "trek.json").read_text())
ADMIN = "https://analyticsadmin.googleapis.com/v1beta"
ADMIN_ALPHA = "https://analyticsadmin.googleapis.com/v1alpha"  # enhanced measurement settings exist only here
DATA = "https://analyticsdata.googleapis.com/v1beta"
# the event parameters that site/analytics.js sends, and their names in the reports.
# "Trek day", not "Day": GA already has a "Day" dimension (the day of the month).
DIMENSIONS = {
    "day": "Trek day", "section": "Section", "photo_id": "Photo", "media": "Media",
    "tab": "Tab", "target": "Map target", "percent": "Scroll percent", "language": "Page language",
}


def token() -> str:
    sa = os.environ.get("GA_SERVICE_ACCOUNT")
    if not sa:
        sys.exit("set GA_SERVICE_ACCOUNT to the service account that is an Editor on the Analytics account")
    cmd = ["gcloud", "auth", "print-access-token", f"--impersonate-service-account={sa}",
           "--scopes=https://www.googleapis.com/auth/analytics.edit,https://www.googleapis.com/auth/analytics.readonly"]  # edit for setup, readonly for the Data API
    if os.environ.get("GA_GCLOUD_ACCOUNT"):
        cmd.append(f"--account={os.environ['GA_GCLOUD_ACCOUNT']}")
    out = subprocess.run(cmd, capture_output=True, text=True, check=True).stdout.strip()
    if not out:
        sys.exit("gcloud gave an empty token")
    return out


S = requests.Session()


def call(method: str, url: str, **kw) -> dict:
    r = S.request(method, url, timeout=30, **kw)
    if not r.ok:
        sys.exit(f"{method} {url}: {r.status_code} {r.text[:500]}")
    return r.json()


def find_stream(gid: str) -> str:
    """properties/<n>/dataStreams/<m>: the web stream that reports to the measurement id."""
    for acc in call("GET", f"{ADMIN}/accountSummaries").get("accountSummaries", []):
        for p in acc.get("propertySummaries", []):
            for s in call("GET", f"{ADMIN}/{p['property']}/dataStreams").get("dataStreams", []):
                if s.get("webStreamData", {}).get("measurementId") == gid:
                    return s["name"]
    sys.exit(f"no Analytics property that the service account can see has a web stream with {gid}")


def setup(stream: str) -> None:
    prop = stream.split("/dataStreams/")[0]
    # the page changes its address as the reader scrolls (?at=d3) and opens things (?photo=, ?map=);
    # with GA's page changes on history events, each of those counts as a page view
    ems = call("GET", f"{ADMIN_ALPHA}/{stream}/enhancedMeasurementSettings")
    if ems.get("pageChangesEnabled"):
        call("PATCH", f"{ADMIN_ALPHA}/{stream}/enhancedMeasurementSettings?updateMask=pageChangesEnabled", json={"pageChangesEnabled": False})
        print("turned off page views on history changes")
    have = {d["parameterName"]: d for d in call("GET", f"{ADMIN}/{prop}/customDimensions").get("customDimensions", [])}
    for param, name in DIMENSIONS.items():
        d = have.get(param)
        if d is None:
            call("POST", f"{ADMIN}/{prop}/customDimensions", json={"parameterName": param, "displayName": name, "scope": "EVENT"})
            print(f"created  {name} ({param})")
        elif d["displayName"] != name:
            call("PATCH", f"{ADMIN}/{d['name']}?updateMask=displayName", json={"displayName": name})
            print(f"renamed  {d['displayName']} -> {name} ({param})")
        else:
            print(f"ok       {name} ({param})")


def run(prop: str, days: int, dims: list[str], mets: list[str], event: str | None = None, limit: int = 15,
        order: str | None = None) -> list[list[str]]:
    body = {"dateRanges": [{"startDate": f"{days}daysAgo", "endDate": "today"}],
            "dimensions": [{"name": d} for d in dims], "metrics": [{"name": m} for m in mets], "limit": limit,
            "orderBys": [{"dimension": {"dimensionName": order}}] if order else [{"metric": {"metricName": mets[0]}, "desc": True}]}
    if event:
        body["dimensionFilter"] = {"filter": {"fieldName": "eventName", "stringFilter": {"value": event}}}
    res = call("POST", f"{DATA}/{prop}:runReport", json=body)
    return [[v["value"] for v in r.get("dimensionValues", [])] + [v["value"] for v in r.get("metricValues", [])]
            for r in res.get("rows", [])]


def table(title: str, head: list[str], rows: list[list[str]]) -> None:
    print(f"\n{title}")
    if not rows:
        print("  (no data yet)")
        return
    w = [max(len(str(x)) for x in col) for col in zip(head, *rows)]
    for r in [head] + rows:
        print("  " + "  ".join(str(x).ljust(n) for x, n in zip(r, w)))


def report(prop: str, days: int) -> None:
    print(f"{TREK['hostname']}, the last {days} days")
    by_date = run(prop, days, ["date"], ["activeUsers", "screenPageViews", "userEngagementDuration"], limit=days + 1, order="date")
    table("Visitors by date", ["date", "users", "views", "engaged seconds per user"],
          [[d, u, v, f"{float(s) / max(int(u), 1):.0f}"] for d, u, v, s in by_date])
    table("Pages", ["page", "views", "users"], run(prop, days, ["pagePath"], ["screenPageViews", "activeUsers"]))
    table("How far down the page (page views that reached it)", ["percent", "page views", "users"],
          run(prop, days, ["customEvent:percent"], ["eventCount", "totalUsers"], "scroll_depth", order="customEvent:percent"))
    table("Days reached", ["day", "page views", "users"],
          run(prop, days, ["customEvent:day"], ["eventCount", "totalUsers"], "day_view", limit=40, order="customEvent:day"))
    table("Sections reached", ["section", "page views", "users"], run(prop, days, ["customEvent:section"], ["eventCount", "totalUsers"], "section_view"))
    table("Pictures opened", ["picture", "day", "views", "users"], run(prop, days, ["customEvent:photo_id", "customEvent:day"], ["eventCount", "totalUsers"], "photo_view"))
    table("Map links followed", ["target", "clicks", "users"], run(prop, days, ["customEvent:target"], ["eventCount", "totalUsers"], "map_link"))
    table("All events", ["event", "count", "users"], run(prop, days, ["eventName"], ["eventCount", "totalUsers"], limit=40))
    table("Where visitors come from", ["source", "sessions", "users"], run(prop, days, ["sessionSource"], ["sessions", "activeUsers"]))
    table("Countries and devices", ["country", "device", "users"], run(prop, days, ["country", "deviceCategory"], ["activeUsers"]))


def live(prop: str) -> None:
    rt = lambda body: call("POST", f"{DATA}/{prop}:runRealtimeReport", json=body).get("rows", [])
    users = rt({"metrics": [{"name": "activeUsers"}]})  # the realtime API does not pair users with event names
    print(f"{TREK['hostname']}, the last 30 minutes: {users[0]['metricValues'][0]['value'] if users else 0} users")
    table("Events", ["event", "count"], [[r["dimensionValues"][0]["value"], r["metricValues"][0]["value"]]
                                         for r in rt({"dimensions": [{"name": "eventName"}], "metrics": [{"name": "eventCount"}]})])


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["setup", "report", "live"])
    ap.add_argument("--days", type=int, default=28)
    a = ap.parse_args()
    gid = TREK.get("analytics")
    if not gid:
        sys.exit('trek.json has no "analytics" measurement id')
    S.headers["Authorization"] = f"Bearer {token()}"
    stream = find_stream(gid)
    prop = stream.split("/dataStreams/")[0]
    {"setup": lambda: setup(stream), "report": lambda: report(prop, a.days), "live": lambda: live(prop)}[a.command]()


if __name__ == "__main__":
    main()
