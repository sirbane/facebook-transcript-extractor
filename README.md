# Facebook Transcript Extractor

A public API that attempts to transcribe publicly accessible Facebook videos and Reels. The Cloudflare Worker uses Facebook page metadata to locate a public video stream, Cloudflare Media Transformations to extract audio, and Cloudflare Workers AI Whisper for transcription.

It does not bypass Facebook login, privacy settings, DRM, or other access controls. It is best-effort: Facebook may change its page format or block automated requests, and some public links may not expose a usable media URL.

## Live Cloudflare service

- Health: https://facebook-transcript-extractor.griffinobungah189.workers.dev/health
- OpenAPI schema: https://facebook-transcript-extractor.griffinobungah189.workers.dev/openapi.json
- Transcription endpoint: `POST https://facebook-transcript-extractor.griffinobungah189.workers.dev/transcribe`

The Worker is deployed with two bindings:
- `AI`: Cloudflare Workers AI
- `MEDIA`: Cloudflare Media Transformations

## Configure the API key

The transcription endpoint is intentionally locked until an API key secret is configured.

1. Open the Cloudflare dashboard.
2. Go to **Workers & Pages** and open `facebook-transcript-extractor`.
3. Open **Settings → Variables and Secrets**.
4. Add a secret named `API_KEY`.
5. Generate a long random value and store it in a password manager. Do not commit it to GitHub.
6. Use the same value as the Bearer API key in the ChatGPT Action configuration.

The health and OpenAPI endpoints do not require authentication. The transcription endpoint requires:

```http
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

## Request

```http
POST /transcribe
```

```json
{
  "facebook_url": "https://www.facebook.com/reel/...",
  "language": "en"
}
```

The `language` field is optional. Omit it to allow Whisper to identify the language.

## Response

```json
{
  "source_url": "https://www.facebook.com/reel/...",
  "transcript": "The recognized words...",
  "vtt": "WEBVTT...",
  "word_count": 42,
  "words": [],
  "method": "facebook_public_video_to_cloudflare_whisper"
}
```

## Connect to a Custom GPT

1. Open the GPT editor and add an Action.
2. Import this schema URL:
   `https://facebook-transcript-extractor.griffinobungah189.workers.dev/openapi.json`
3. Configure authentication as **API Key → Bearer**.
4. Paste the same secret value configured as `API_KEY` in Cloudflare.
5. Save and test the Action before sharing the GPT.

The GPT can then call `transcribeFacebookVideo` when someone provides a public Facebook video or Reel URL.

## Processing limits

- Video input is limited to 100 MB.
- Audio output is limited to 25 MB.
- Media extraction is capped at 10 minutes per video.
- Cloudflare Workers Free includes 100,000 requests per day.
- Workers AI currently includes 10,000 Neurons per day. The Whisper model uses approximately 41.14 Neurons per audio minute, so the theoretical allowance is about 243 audio minutes per day across the account, shared with other Workers AI use.
- Cloudflare currently documents the Media Transformations Worker binding as open beta, with binding operations not billed during the beta. Check current pricing before relying on this for a public service.

Free allocations are shared at account level and can be exhausted. If they are reached, new transcription requests may fail until the daily reset.

## Local Python implementation

The original FastAPI implementation remains in `app.py`. It uses `yt-dlp` and `faster-whisper` and is intended for local or separately hosted use. It is not used by the deployed Cloudflare Worker.

## Repository

https://github.com/sirbane/facebook-transcript-extractor

## License

MIT
