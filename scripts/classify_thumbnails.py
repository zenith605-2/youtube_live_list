"""CLIP 제로샷으로 썸네일을 보고 카테고리를 분류한다.

매일 GitHub Actions에서 update.mjs 다음에 실행된다.
- 대상: 아직 AI 분류를 안 거쳤고(ai_checked_at is null), 유저가 직접 카테고리를
  고치지 않은(category_source != 'user') 행
- 라이브는 실시간 스냅샷(hqdefault_live.jpg), 일반 영상은 저장된 썸네일을 내려받아
  분류에만 쓰고 즉시 폐기한다 (디스크/DB에 이미지 저장 안 함)
- 확신도가 낮으면 기존 카테고리를 유지하고 체크 기록만 남긴다

환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, (선택) DRY_RUN=1, BATCH_LIMIT
"""

import io
import os
import sys

import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
DRY_RUN = os.environ.get("DRY_RUN") == "1"
BATCH_LIMIT = int(os.environ.get("BATCH_LIMIT", "500"))
# 실측 테스트(정답 카테고리를 아는 10개 썸네일) 기준: 정답 케이스는 대부분 0.5~1.0,
# 오판 케이스는 낮은 점수에 몰려 있어 0.5 미만이면 기존 분류를 유지하는 게 더 정확했다
CONFIDENCE_THRESHOLD = 0.50

if not SUPABASE_URL or not SERVICE_KEY:
    print("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.", file=sys.stderr)
    sys.exit(1)

HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}

# 카테고리별 CLIP 프롬프트 (프롬프트별 확률을 카테고리 단위로 합산해 비교)
# 주의: dashcam/walk는 화면 내용이 아니라 "촬영 시점(1인칭)"으로 정의되는 장르라 CLIP이
# 장면만 보고는 traffic/downtown과 구분하지 못한다(실측 결과 거리 장면을 죄다 walk로 분류).
# 이 둘은 제목 키워드 분류에 맡기고, CLIP은 장면으로 구분되는 카테고리만 판별한다.
CATEGORY_PROMPTS = {
    "beach": [
        "a beach with sand and ocean waves",
        "a coastal shoreline with the sea",
    ],
    "parking": [
        "a parking lot with rows of parked cars",
    ],
    "traffic": [
        "a road intersection with car traffic",
        "cars driving on a highway or road",
    ],
    "harbor": [
        "a harbor with boats and ships docked at a marina",
        "a port waterfront with vessels on the water",
    ],
    "airport": [
        "an airport runway with airplanes taking off or landing",
        "airplanes parked at airport terminal gates",
    ],
    "train": [
        "a train on railway tracks",
        "a railway station platform with trains",
    ],
    "river": [
        "a river or canal waterfront",
    ],
    "plaza": [
        "an open public square or plaza in a city",
    ],
    "park": [
        "a green park with trees, grass and walking paths",
    ],
    "alley": [
        "a narrow alley between buildings",
    ],
    "construction": [
        "a construction site with cranes and heavy machinery",
    ],
    "aerial": [
        "an aerial view of the ground from a drone or high altitude",
    ],
    "mountain": [
        "a mountain landscape with peaks or forest hills",
        "a ski slope with snow in the mountains",
    ],
    "downtown": [
        "a city street with buildings, shops and pedestrians",
        "a downtown plaza or crossing in a city",
    ],
    "skyline": [
        "a wide panoramic view of a city skyline with many buildings seen from far away",
        "an aerial cityscape seen from a high observation point or tower",
    ],
    "wildlife": [
        "wild animals in nature",
        "birds or animals at a feeder or waterhole",
    ],
    "crowd": [
        "a large dense crowd of many people",
    ],
    "indoor": [
        "the interior of a room inside a building",
    ],
}

# 촬영 시점(장르) 기반이라 CLIP이 판별할 수 없는 카테고리 — 현재 카테고리가 이거면 건너뛴다
PERSPECTIVE_CATEGORIES = {"dashcam", "walk"}


def fetch_category_keys():
    """DB에 실제로 존재하는 카테고리만 CLIP 후보로 쓴다 (아직 추가 안 된 카테고리 프롬프트는 무시)"""
    url = f"{SUPABASE_URL}/rest/v1/categories?select=key"
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    return {row["key"] for row in r.json()}


def fetch_targets():
    # ai 분류 미체크 + 유저 수정분 제외
    url = (
        f"{SUPABASE_URL}/rest/v1/streams"
        f"?select=video_id,thumbnail,category,category_source,content_type"
        f"&ai_checked_at=is.null"
        f"&or=(category_source.is.null,category_source.neq.user)"
        f"&limit={BATCH_LIMIT}"
    )
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    return r.json()


def thumbnail_url(row):
    if (row.get("content_type") or "live") == "live":
        # 라이브는 지금 이 순간의 화면 스냅샷이 분류에 가장 정확하다
        return f"https://i.ytimg.com/vi/{row['video_id']}/hqdefault_live.jpg"
    return row.get("thumbnail") or f"https://i.ytimg.com/vi/{row['video_id']}/hqdefault.jpg"


def download_image(url, fallback=None):
    from PIL import Image

    for candidate in [url, fallback]:
        if not candidate:
            continue
        try:
            r = requests.get(candidate, timeout=15)
            if r.status_code != 200 or len(r.content) < 1000:
                continue
            return Image.open(io.BytesIO(r.content)).convert("RGB")
        except Exception:
            continue
    return None


def patch_row(video_id, payload):
    if DRY_RUN:
        return
    url = f"{SUPABASE_URL}/rest/v1/streams?video_id=eq.{video_id}"
    r = requests.patch(url, headers=HEADERS, json=payload, timeout=30)
    r.raise_for_status()


def main():
    rows = fetch_targets()
    print(f"AI 분류 대상: {len(rows)}건 (dry_run={DRY_RUN})")
    if not rows:
        return

    import torch
    from transformers import CLIPModel, CLIPProcessor

    model_name = "openai/clip-vit-base-patch32"
    print(f"모델 로딩: {model_name}")
    model = CLIPModel.from_pretrained(model_name)
    processor = CLIPProcessor.from_pretrained(model_name)
    model.eval()

    valid_keys = fetch_category_keys()
    prompts = []
    prompt_category = []
    for cat, plist in CATEGORY_PROMPTS.items():
        if cat not in valid_keys:
            continue
        for p in plist:
            prompts.append(p)
            prompt_category.append(cat)

    from datetime import datetime, timezone

    changed = 0
    kept = 0
    skipped = 0
    now_iso = datetime.now(timezone.utc).isoformat()

    for row in rows:
        vid = row["video_id"]
        # 키워드가 dashcam/walk로 분류한 건 시점 기반 장르라 CLIP이 판단할 수 없음 -> 그대로 둔다
        if row.get("category") in PERSPECTIVE_CATEGORIES:
            patch_row(vid, {"ai_checked_at": now_iso})
            kept += 1
            continue
        img = download_image(thumbnail_url(row), fallback=row.get("thumbnail"))
        if img is None:
            # 썸네일 자체를 못 받으면 체크 기록만 남기고 넘어간다
            patch_row(vid, {"ai_checked_at": now_iso})
            skipped += 1
            continue

        inputs = processor(text=prompts, images=img, return_tensors="pt", padding=True)
        with torch.no_grad():
            outputs = model(**inputs)
        probs = outputs.logits_per_image.softmax(dim=-1)[0]

        # 프롬프트별 확률을 카테고리 단위로 합산
        cat_scores = {}
        for i, cat in enumerate(prompt_category):
            cat_scores[cat] = cat_scores.get(cat, 0.0) + probs[i].item()
        best_cat, best_score = max(cat_scores.items(), key=lambda kv: kv[1])

        payload = {"ai_checked_at": now_iso}
        if best_score >= CONFIDENCE_THRESHOLD and best_cat != row.get("category"):
            payload["category"] = best_cat
            payload["category_source"] = "ai"
            changed += 1
            print(f"  {vid}: {row.get('category')} -> {best_cat} ({best_score:.2f})")
        else:
            kept += 1
        patch_row(vid, payload)

    print(f"완료: 변경 {changed} / 유지 {kept} / 썸네일없음 {skipped}")


if __name__ == "__main__":
    main()
