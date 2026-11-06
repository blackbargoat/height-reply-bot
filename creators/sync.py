"""GoPeak creator program detector.

Lists recent posts on every active creator's TikTok and YouTube with yt-dlp and sends them to the "creators" edge
function, which links them to approved drafts or flags them (after a 24 h grace period) if they weren't approved.
Instagram needs a login to list posts, so Instagram posts are counted when the creator pastes the live link.
Env: CP_SYNC_KEY (secret), CP_URL (optional, defaults to the GoPeak project).
"""
import json, os, subprocess, sys, urllib.request
from datetime import datetime, timezone

URL = os.environ.get("CP_URL", "https://etdbjahwegsmuelcawgf.supabase.co/functions/v1/creators")
KEY = os.environ["CP_SYNC_KEY"]
APIKEY = "sb_publishable_p8exB2dS5lpdz-p1chueJA_n9zRQdnG"
ITEMS = os.environ.get("CP_ITEMS", "1-30")


def call(path, body):
    req = urllib.request.Request(f"{URL}/{path}", data=json.dumps(body).encode(), method="POST",
                                 headers={"content-type": "application/json", "apikey": APIKEY, "x-sync-key": KEY})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def listing(url):
    try:
        out = subprocess.run(["yt-dlp", "--flat-playlist", "-J", "--playlist-items", ITEMS, "--no-warnings", url],
                             capture_output=True, text=True, timeout=180)
        return json.loads(out.stdout).get("entries") or [] if out.returncode == 0 and out.stdout.strip() else []
    except Exception as e:  # one broken account shouldn't stop the rest
        print("listing failed", url, e, file=sys.stderr)
        return []


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat() if ts else None


posts = []
for c in call("sync/handles", {}):
    for acc in c.get("accounts", []):
        h, plat = acc["handle"], acc["platform"]
        if plat == "tiktok":
            es = listing(f"https://www.tiktok.com/@{h}")
            print(f"tiktok @{h}: {len(es)}")
            for e in es:
                posts.append({"creator_id": c["id"], "platform": "tiktok", "external_id": str(e["id"]),
                              "url": e.get("url") or f"https://www.tiktok.com/@{h}/video/{e['id']}",
                              "posted_at": iso(e.get("timestamp")), "caption": e.get("title"),
                              "views": e.get("view_count"), "likes": e.get("like_count"), "comments": e.get("comment_count")})
        elif plat == "youtube":
            seen = set()
            for tab in ("shorts", "videos"):
                es = listing(f"https://www.youtube.com/@{h}/{tab}")
                print(f"youtube @{h} {tab}: {len(es)}")
                for e in es:
                    if e["id"] in seen:
                        continue
                    seen.add(e["id"])
                    posts.append({"creator_id": c["id"], "platform": "youtube", "external_id": str(e["id"]),
                                  "url": f"https://www.youtube.com/shorts/{e['id']}" if tab == "shorts" else f"https://www.youtube.com/watch?v={e['id']}",
                                  "posted_at": iso(e.get("timestamp")), "caption": e.get("title"), "views": e.get("view_count")})
        # instagram: needs a login to list posts, counted when the creator pastes the link

print(call("sync/posts", {"posts": posts}))
