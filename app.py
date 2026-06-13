from __future__ import annotations

import base64
import hashlib
import io
import random
import secrets
import time
from dataclasses import dataclass
from pathlib import Path
import json
from flask_cors import CORS

from flask import Flask, jsonify, request, send_from_directory
from PIL import Image, ImageDraw, ImageFilter, ImageFont


app = Flask(__name__)
CORS(app)

SESSION_TTL_SECONDS = 5 * 60
SESSION_SALT = secrets.token_hex(16)


@dataclass
class CaptchaSession:
    answer_hash: str
    expires_at: float
    verified: bool = False


captcha_sessions: dict[str, CaptchaSession] = {}


@app.get("/")
def index():
    return send_from_directory(app.root_path, "test.html")

@app.post("/")
def index_post():
    payload = request.get_json(silent=True) or request.form or request.args
    session_id = payload.get("sessionId") or payload.get("session_id") or payload.get("tec_capture_session_id")
    session = captcha_sessions.pop(session_id, None) if session_id else None

    if not session or session.expires_at < time.time():
        return "認証できていません。"

    return "認証が完了しました！"

@app.get("/capture.js")
def capture_js():
    return send_from_directory(app.root_path, "capture.js")


@app.route("/api/captcha", methods=["GET", "POST"])
def captcha():
    if request.method == "POST":
        return verify_captcha()

    return create_captcha()


@app.route("/api/captcha/status", methods=["GET", "POST"])
def captcha_status():
    return check_captcha_status()


def create_captcha():
    cleanup_expired_sessions()

    with open("data.json") as data:
        _dict = json.load(data)

    skill = normalize_skill(request.args.get("skill", "python"))
    challenge = random.choice(_dict.get(skill))
    session_id = secrets.token_urlsafe(24)
    captcha_sessions[session_id] = CaptchaSession(
        answer_hash=hash_answer(challenge["correct"]),
        expires_at=time.time() + SESSION_TTL_SECONDS,
    )

    answers = [challenge["correct"], *challenge["wrong"]]
    random.shuffle(answers)

    return jsonify(
        {
            "sessionId": session_id,
            "question": "Read the image and choose the correct answer.",
            "image": make_challenge_image(challenge["question"]),
            "answers": answers,
            "hint": "The image uses noise and distortion to make automated reading harder.",
        }
    )


def verify_captcha():
    payload = request.get_json(silent=True) or request.form
    session_id = payload.get("sessionId") or payload.get("session_id")
    answer = payload.get("answer", "")

    session = captcha_sessions.get(session_id) if session_id else None

    if not session or session.expires_at < time.time():
        captcha_sessions.pop(session_id, None)
        return jsonify({"correct": False})

    is_correct = secrets.compare_digest(session.answer_hash, hash_answer(answer))
    session.verified = is_correct

    if not is_correct:
        captcha_sessions.pop(session_id, None)

    return jsonify({"correct": is_correct})


def check_captcha_status():
    payload = request.get_json(silent=True) or request.form or request.args
    session_id = payload.get("sessionId") or payload.get("session_id") or payload.get("tec_capture_session_id")
    session = captcha_sessions.pop(session_id, None) if session_id else None

    if not session or session.expires_at < time.time():
        return jsonify({"verified": False})

    return jsonify({"verified": session.verified})


def make_challenge_image(text: str) -> str:
    width, height = 640, 180
    image = Image.new("RGB", (width, height), "#f6f8fa")
    draw = ImageDraw.Draw(image)
    font = load_font(26)

    for _ in range(1800):
        x = random.randrange(width)
        y = random.randrange(height)
        shade = random.randrange(120, 230)
        draw.point((x, y), fill=(shade, shade, shade))

    for _ in range(12):
        color = tuple(random.randrange(80, 180) for _ in range(3))
        draw.line(
            (
                random.randrange(width),
                random.randrange(height),
                random.randrange(width),
                random.randrange(height),
            ),
            fill=color,
            width=random.randrange(1, 4),
        )

    wrapped = wrap_text(text, 36)
    y = 48
    for line in wrapped:
        x = 32 + random.randrange(-8, 12)
        angle = random.uniform(-4, 4)
        line_image = Image.new("RGBA", (width - 64, 42), (255, 255, 255, 0))
        line_draw = ImageDraw.Draw(line_image)
        line_draw.text((0, 0), line, font=font, fill=(20, 30, 45, 255))
        line_image = line_image.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
        image.paste(line_image, (x, y + random.randrange(-3, 4)), line_image)
        y += 42

    image = image.transform(
        image.size,
        Image.Transform.AFFINE,
        (1, random.uniform(-0.05, 0.05), random.randrange(-8, 8), random.uniform(-0.04, 0.04), 1, 0),
        resample=Image.Resampling.BICUBIC,
    )
    image = image.filter(ImageFilter.GaussianBlur(radius=0.35))

    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def load_font(size: int):
    font_candidates = [
        "NotoSansJP.ttf",
    ]

    for font_path in font_candidates:
        if Path(font_path).exists():
            return ImageFont.truetype(font_path, size=size)

    return ImageFont.load_default()


def wrap_text(text: str, limit: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current: list[str] = []

    for word in words:
        candidate = " ".join([*current, word])
        if len(candidate) > limit and current:
            lines.append(" ".join(current))
            current = [word]
        else:
            current.append(word)

    if current:
        lines.append(" ".join(current))

    return lines


def cleanup_expired_sessions():
    now = time.time()
    expired = [session_id for session_id, session in captcha_sessions.items() if session.expires_at < now]

    for session_id in expired:
        captcha_sessions.pop(session_id, None)


def hash_answer(answer: str) -> str:
    normalized = " ".join(str(answer).strip().casefold().split())
    return hashlib.sha256(f"{SESSION_SALT}:{normalized}".encode("utf-8")).hexdigest()


def normalize_skill(skill: str) -> str:
    return str(skill).strip().casefold() or "javascript"

if __name__ == "__main__":
    app.run(debug=False)
