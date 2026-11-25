import os
import re
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, HttpUrl
import yt_dlp
from faster_whisper import WhisperModel

load_dotenv()

app = FastAPI(
    title="Facebook Transcript Extractor",
    description="Transcribe publicly accessible Facebook videos and Reels. No private-content or access-control bypass.",
    version="1.0.0",
    servers=[{"url": os.getenv("PUBLIC_BASE_URL", "http://localhost:8000")}],
)

security = HTTPBearer(auto_error=False)
API_KEY = os.getenv("API_KEY", "").strip()
ALLOWED_HOSTS = {"facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com", "fb.watch"}
MAX_VIDEO_SECONDS = int(os.getenv("MAX_VIDEO_SECONDS", "3600"))
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "small")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
_model = None


class TranscribeRequest(BaseModel):
    facebook_url: HttpUrl = Field(..., description="Public Facebook video, Reel, or fb.watch URL")
    language: str | None = Field(default=None, description="Optional ISO language code, e.g. en")
    timestamps: bool = True


class Segment(BaseModel):
    start: float
    end: float
    text: str


class TranscriptResponse(BaseModel):
    source_url: str
    language: str | None
    transcript: str
    segments: list[Segment]
    method: str


def verify_api_key(credentials: HTTPAuthorizationCredentials | None = Depends(security)):
    if API_KEY and (credentials is None or credentials.credentials != API_KEY):
        raise HTTPException(status_code=401, detail="A valid bearer API key is required.")
    return True


def validate_facebook_url(raw_url: str) -> str:
    parsed = urlparse(raw_url)
    host = (parsed.hostname or "").lower().rstrip(".")
    if parsed.scheme != "https" or host not in ALLOWED_HOSTS:
        raise HTTPException(status_code=400, detail="Provide an HTTPS URL from facebook.com or fb.watch.")
    if not parsed.path or parsed.path == "/":
        raise HTTPException(status_code=400, detail="The URL does not appear to identify a video.")
    return raw_url


def get_model():
    global _model
    if _model is None:
        _model = WhisperModel(
            WHISPER_MODEL,
            device=WHISPER_DEVICE,
            compute_type=WHISPER_COMPUTE_TYPE,
            download_root=os.getenv("WHISPER_CACHE", "/tmp/whisper-cache"),
        )
    return _model


def extract_media(url: str, folder: str) -> tuple[Path, Path | None]:
    output = str(Path(folder) / "source.%(ext)s")
    opts = {
        "format": "bestaudio/best",
        "outtmpl": output,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "socket_timeout": 25,
        "retries": 2,
        "max_filesize": 500 * 1024 * 1024,
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitleslangs": ["all"],
        "subtitlesformat": "vtt/best",
        "match_filter": yt_dlp.utils.match_filter_func(
            f"duration <= {MAX_VIDEO_SECONDS}"
        ),
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail="Facebook could not provide this video to the extractor. It may require login, be private, unavailable, or blocked. No access controls were bypassed.",
        ) from exc

    folder_path = Path(folder)
    subtitles = next(iter(folder_path.glob("*.vtt")), None)
    audio_candidates = [
        p for p in folder_path.glob("source.*")
        if p.suffix.lower() not in {".vtt", ".json", ".jpg", ".webp", ".png"}
    ]
    if not audio_candidates:
        raise HTTPException(status_code=422, detail="No accessible audio stream was found.")
    audio = max(audio_candidates, key=lambda p: p.stat().st_size)
    return audio, subtitles


def parse_vtt(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8", errors="ignore")
    blocks = re.split(r"\n\s*\n", text)
    segments = []
    for block in blocks:
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        timing_index = next((i for i, line in enumerate(lines) if "-->" in line), None)
        if timing_index is None:
            continue
        timing = lines[timing_index].split("-->")[0].strip().split(" ")[0]
        try:
            parts = timing.replace(",", ".").split(":")
            seconds = sum(float(part) * (60 ** i) for i, part in enumerate(reversed(parts)))
        except ValueError:
            seconds = 0.0
        cue = re.sub(r"<[^>]+>", "", " ".join(lines[timing_index + 1:])).strip()
        cue = re.sub(r"&amp;", "&", cue)
        if cue and (not segments or segments[-1]["text"] != cue):
            segments.append({"start": seconds, "end": seconds, "text": cue})
    return segments


def transcribe_url(raw_url: str, language: str | None = None) -> dict:
    url = validate_facebook_url(raw_url)
    with tempfile.TemporaryDirectory(prefix="fb-transcript-") as tmp:
        audio, subtitles = extract_media(url, tmp)
        if subtitles:
            caption_segments = parse_vtt(subtitles)
            if caption_segments:
                return {
                    "source_url": url,
                    "language": language,
                    "transcript": " ".join(s["text"] for s in caption_segments),
                    "segments": caption_segments,
                    "method": "facebook_captions",
                }

        try:
            model = get_model()
            segments_iter, info = model.transcribe(
                str(audio),
                language=language,
                vad_filter=True,
                beam_size=5,
            )
            segments = [
                {"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()}
                for s in segments_iter if s.text.strip()
            ]
        except Exception as exc:
            raise HTTPException(status_code=500, detail="Audio transcription failed. Check FFmpeg, model resources, and server logs.") from exc

        return {
            "source_url": url,
            "language": info.language,
            "transcript": " ".join(s["text"] for s in segments),
            "segments": segments,
            "method": "whisper",
        }


@app.get("/health", operation_id="health_check")
def health():
    return {"status": "ok", "service": "facebook-transcript-extractor"}


@app.post(
    "/transcribe",
    response_model=TranscriptResponse,
    operation_id="transcribe_facebook_video",
    summary="Transcribe a public Facebook video or Reel",
)
def transcribe(request: TranscribeRequest, _: bool = Depends(verify_api_key)):
    result = transcribe_url(str(request.facebook_url), request.language)
    if not request.timestamps:
        result["segments"] = []
    return result
