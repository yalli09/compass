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

BLOCKED_SITES = [
    "getyourguide.com",
    "expedia.com",
    "booking.com",
    "viator.com",
]


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


# =============================
# SCORING ENGINE
# =============================

def score(result: dict) -> int:
    url = (result.get("image") or "").lower()

    base = 0
    kind = detect(url)

    if kind == "wiki":
        base += 50_000_000  # BEST
    elif kind == "tripadvisor":
        base += 35_000_000  # HIGH (real tourist photos)
    elif kind == "photo":
        base += 25_000_000  # good photography
    else:
        base += 1_000_000   # weak fallback

    # small resolution boost (safe, capped)
    try:
        w = int(result.get("width") or 0)
        h = int(result.get("height") or 0)
        base += min(w * h, 5_000_000)
    except:
        pass

    return base


# =============================
# MAIN FUNCTION
# =============================

def get_best_image(query: str):
    with DDGS() as ddgs:
        results = list(ddgs.images(query, max_results=60))

    # filter bad / blocked
    results = [
        r for r in results
        if is_valid(r.get("image")) and not is_blocked(r.get("image"))
    ]

    if not results:
        return None

    # sort by score (BEST FIRST)
    results.sort(key=score, reverse=True)

    return results[0]["image"]


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