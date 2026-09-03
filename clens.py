from ddgs import DDGS


# =============================
# PRIORITY RULES
# =============================

WIKIMEDIA = [
    "upload.wikimedia.org",
    "wikimedia.org",
    "wikipedia.org",
]

TRIPADVISOR_CDN = [
    "dynamic-media-cdn.tripadvisor.com",
]

GOOD_PHOTO_SITES = [
    "unsplash.com",
    "pexels.com",
    "pixabay.com",
    "flickr.com",
    "500px.com",
]

# Sites that are either watermarked, expire/require auth, or are
# generally re-hosted low-quality copies -> never usable as "best image"
BLOCKED_SITES = [
    "getyourguide.com",
    "expedia.com",
    "booking.com",
    "viator.com",
    "pinterest.",          # re-hosted copies, links die often
    "facebook.com",
    "fbcdn.net",           # expiring/auth-walled CDN links
    "instagram.com",
    "shutterstock.com",    # watermarked previews
    "istockphoto.com",
    "gettyimages.com",
    "alamy.com",
    "dreamstime.com",
    "depositphotos.com",
    "123rf.com",
]

# Title/URL keywords that reliably signal "not a real photo"
BAD_KEYWORDS = [
    "icon", "clipart", "clip-art", "vector", "logo", "sticker",
    "cartoon", "coloring page", "coloring-page", "template",
    "watermark", "diagram", "floor plan", "floor-plan", "screenshot",
]

TIER_SCORES = {"wiki": 4, "tripadvisor": 3, "photo": 2, "other": 1}

MIN_WIDTH = 600
MIN_HEIGHT = 400
MAX_ASPECT_RATIO = 2.5  # reject banner/panorama-shaped images
RESOLUTION_CAP = 4_000_000  # secondary tiebreaker, never lets size beat tier


# =============================
# HELPERS
# =============================

def is_valid(url: str) -> bool:
    return bool(url and url.startswith("http"))


def is_blocked(url: str) -> bool:
    url = url.lower()
    return any(b in url for b in BLOCKED_SITES)


def detect(url: str) -> str:
    url = url.lower()
    if any(x in url for x in WIKIMEDIA):
        return "wiki"
    if any(x in url for x in TRIPADVISOR_CDN):
        return "tripadvisor"
    if any(x in url for x in GOOD_PHOTO_SITES):
        return "photo"
    return "other"


def safe_int(v) -> int:
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        return 0


def upgrade_wikimedia(url: str) -> str:
    """Wikimedia search results are often small /thumb/ renders.
    Strip the thumb path + size suffix to get the full-resolution original."""
    if "/thumb/" not in url:
        return url
    try:
        base, _, _ = url.rpartition("/")  # drop the trailing "220px-Example.jpg"
        return base.replace("/thumb/", "/")
    except Exception:
        return url


def has_bad_keywords(result: dict) -> bool:
    text = f"{result.get('title', '')} {result.get('image', '')}".lower()
    return any(k in text for k in BAD_KEYWORDS)


def passes_quality(result: dict) -> bool:
    """Strict pass: real-photo-shaped, decent resolution, no junk keywords."""
    if has_bad_keywords(result):
        return False
    w, h = safe_int(result.get("width")), safe_int(result.get("height"))
    if w and h:
        if w < MIN_WIDTH or h < MIN_HEIGHT:
            return False
        if max(w, h) / max(min(w, h), 1) > MAX_ASPECT_RATIO:
            return False
    return True


# =============================
# SCORING ENGINE
# =============================

def score(result: dict) -> tuple:
    """Tier always dominates; resolution only breaks ties within a tier."""
    url = (result.get("image") or "").lower()
    tier_val = TIER_SCORES.get(detect(url), 1)
    w, h = safe_int(result.get("width")), safe_int(result.get("height"))
    area = min(w * h, RESOLUTION_CAP)
    return (tier_val, area)


# =============================
# SEARCH (with retries, since ddgs can rate-limit / hiccup)
# =============================

def _search(query: str, max_results: int = 60, retries: int = 2):
    last_err = None
    for _ in range(retries + 1):
        try:
            with DDGS() as ddgs:
                return list(ddgs.images(query, max_results=max_results, safesearch="moderate"))
        except Exception as e:
            last_err = e
            continue
    print(f"[get_best_image] search failed for '{query}': {last_err}")
    return []


# =============================
# MAIN FUNCTION
# =============================

def get_best_image(query: str):
    raw = _search(query)

    # Fallback query for obscure/niche subjects that return nothing
    if not raw:
        raw = _search(f"{query} photo")
        if not raw:
            return None

    candidates = []
    for r in raw:
        url = r.get("image")
        if not is_valid(url) or is_blocked(url):
            continue
        if detect(url) == "wiki":
            r["image"] = upgrade_wikimedia(url)
        candidates.append(r)

    if not candidates:
        return None

    # Prefer results that pass strict quality checks; if that empties the
    # pool (common for very niche subjects), fall back to the raw candidates
    # rather than returning nothing.
    strict = [r for r in candidates if passes_quality(r)]
    pool = strict if strict else candidates

    pool.sort(key=score, reverse=True)
    return pool[0]["image"]


# =============================
# RUN LOOP
# =============================

if __name__ == "__main__":
    while True:
        q = input("\nSearch (or 'exit'): ").strip()

        if q.lower() == "exit":
            break

        img = get_best_image(q)

        print("\nBest image:")
        print(img if img else "No image found")