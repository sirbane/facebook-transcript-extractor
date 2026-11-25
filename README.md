# Facebook Transcript Extractor

A self-hostable service that turns **publicly accessible Facebook videos, Reels, and video posts** into readable transcripts. It exposes a REST API with an OpenAPI schema for Custom GPT Actions, plus an optional MCP server for compatible clients.

## What it does

- Accepts Facebook video, Reel, and `fb.watch` URLs.
- Uses available subtitles when present; otherwise transcribes accessible audio with faster-whisper.
- Returns plain text and timestamped segments.
- Exposes a REST API and optional MCP tool.

## Important limitations

This does not bypass Facebook login, privacy settings, access controls, DRM, or geographic restrictions. The service cannot transcribe a post it cannot legitimately access. Use it only for content you own, have permission to process, or are otherwise authorized to use. Respect copyright and Facebook's terms. Do not submit private links, session cookies, or account credentials.

## Run locally

Requirements: Python 3.11+, FFmpeg, and enough RAM/CPU for Whisper.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app:app --host 0.0.0.0 --port 8000
```

OpenAPI docs: `http://localhost:8000/docs`  
OpenAPI JSON: `http://localhost:8000/openapi.json`

Set a strong `API_KEY` before exposing the API publicly. Send it as `Authorization: Bearer YOUR_KEY`.

## Deploy with Docker

```bash
docker compose up --build
```

The REST API listens on port 8000. Whisper model files are cached in a Docker volume.

## Connect to a Custom GPT (recommended ChatGPT route)

1. Deploy the REST API to a public HTTPS host.
2. Set a strong `API_KEY` and set `PUBLIC_BASE_URL` to the deployed API URL. The Render template can use Render's external URL automatically.
3. In the GPT editor, add an Action and import the deployed `/openapi.json` schema URL.
4. Configure Action authentication as API Key, Bearer, using the same `API_KEY` value.
5. Add these GPT instructions:

   > When a user provides a public Facebook video or Reel URL and asks for a transcript, call the `transcribe_facebook_video` operation. Return the transcript faithfully and preserve timestamps when requested. If extraction fails, explain the access limitation and never invent transcript content.

The GPT can then be shared with other people using the GPT's sharing settings. The API host remains responsible for availability, compute costs, and rate limiting.

## Optional MCP server

Run the MCP server separately:

```bash
python mcp_server.py
```

It exposes the `transcribe_facebook_video` tool over Streamable HTTP on port 8001. The MCP process calls the REST API using the configured `API_KEY`.

**Security note:** the sample MCP listener does not implement inbound client authentication. Do not expose port 8001 directly to the public internet. Put it behind an authentication gateway or use it only on a trusted network. The REST API itself enforces bearer authentication when `API_KEY` is configured.

## API

`POST /transcribe`

```json
{
  "facebook_url": "https://www.facebook.com/reel/...",
  "language": null,
  "timestamps": true
}
```

Response:

```json
{
  "source_url": "https://www.facebook.com/reel/...",
  "language": "en",
  "transcript": "The complete transcript...",
  "segments": [
    {"start": 0.0, "end": 3.2, "text": "The opening sentence."}
  ],
  "method": "whisper"
}
```

Health check: `GET /health`.

## Configuration

- `API_KEY`: optional locally; strongly recommended in production.
- `PUBLIC_BASE_URL`: public HTTPS URL used in the generated OpenAPI schema.
- `WHISPER_MODEL`: default `small`; `tiny` uses fewer resources, `medium` may improve accuracy.
- `WHISPER_DEVICE`: default `cpu`.
- `WHISPER_COMPUTE_TYPE`: default `int8`.
- `MAX_VIDEO_SECONDS`: default `3600`.
- `MCP_HOST`, `MCP_PORT`: optional MCP listener, defaults `0.0.0.0` and `8001`.

## License

MIT
