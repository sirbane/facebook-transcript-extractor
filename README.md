# Facebook Transcript Extractor

A self-hostable service that turns **publicly accessible Facebook videos, Reels, and video posts** into readable transcripts. It exposes both a REST API (with an OpenAPI schema for Custom GPT Actions) and an MCP tool for compatible ChatGPT clients.

## What it does

- Accepts Facebook video, Reel, and `fb.watch` URLs.
- Downloads media only when it is publicly accessible to the server.
- Uses available subtitles when present; otherwise transcribes audio with faster-whisper.
- Returns plain text and timestamped segments.
- Offers REST/OpenAPI and MCP interfaces.

## Important limitations

This does not bypass Facebook login, privacy settings, access controls, DRM, or geographic restrictions. The service cannot transcribe a post it cannot legitimately access. Use it only for content you own, have permission to process, or are otherwise authorized to use. Respect copyright and Facebook's terms. Do not submit private links, session cookies, or account credentials.

## Run locally

Requirements: Python 3.11+, FFmpeg, and (for audio transcription) enough RAM/CPU for Whisper.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app:app --host 0.0.0.0 --port 8000
```

OpenAPI docs: `http://localhost:8000/docs`  
OpenAPI JSON: `http://localhost:8000/openapi.json`

Set `API_KEY` before exposing the service publicly. Send it as `Authorization: Bearer YOUR_KEY`.

## Deploy with Docker

```bash
docker compose up --build
```

The API listens on port 8000. Persistent model caching is stored in the `whisper-cache` volume.

## Connect to a Custom GPT

1. Deploy this API to a public HTTPS host.
2. Open the API's `/openapi.json` endpoint and download the schema.
3. In the GPT editor, add an Action and import the OpenAPI schema.
4. Configure API-key authentication using the same value as `API_KEY`.
5. In the GPT instructions, tell it: "When a user provides a public Facebook video or Reel URL and asks for a transcript, call the `transcribe_facebook_video` operation. Return the transcript faithfully, preserving timestamps when requested. If extraction fails, explain the access limitation and do not invent transcript content."

The generated OpenAPI schema includes the endpoint and bearer security scheme.

## Connect through MCP

Run the MCP server as a separate process against the same codebase:

```bash
python mcp_server.py
```

It exposes the `transcribe_facebook_video` tool over Streamable HTTP at `/mcp` on port 8001 by default. Configure the server URL in an MCP-compatible ChatGPT app/client. If `API_KEY` is set, pass it as a bearer token in the MCP client connection.

## API

`POST /transcribe`

Request:

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
- `WHISPER_MODEL`: default `small`; use `tiny` for lower resource usage or `medium` for better accuracy with more resources.
- `WHISPER_DEVICE`: default `cpu`.
- `WHISPER_COMPUTE_TYPE`: default `int8`.
- `MAX_VIDEO_SECONDS`: default `3600`.
- `MCP_HOST`, `MCP_PORT`: MCP listener, defaults `0.0.0.0` and `8001`.

## License

MIT
