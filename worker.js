const MODEL = "@cf/openai/whisper";
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const ALLOWED_PAGE_HOSTS = new Set([
  "facebook.com", "www.facebook.com", "m.facebook.com",
  "web.facebook.com", "fb.watch"
]);

function json(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, authorization",
      "cache-control": "no-store"
    }
  });
}

function isFacebookHost(host) {
  return ALLOWED_PAGE_HOSTS.has(host) ||
    host.endsWith(".fbcdn.net") ||
    host.endsWith(".fbsbx.com") ||
    host.endsWith(".facebook.com");
}

function decodeCandidate(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/\\u0025/gi, "%")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\\//g, "/")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");
}

function validateFacebookPage(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error("Provide a valid Facebook video or Reel URL."); }
  if (url.protocol !== "https:" || !ALLOWED_PAGE_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Only public Facebook video, Reel, and fb.watch links are supported.");
  }
  return url;
}

function findVideoCandidates(html) {
  const values = [];
  const meta = /<meta\\b[^>]*(?:property|name)=["'](?:og:video(?::secure_url|:url)?|twitter:player:stream)["'][^>]*>/gi;
  for (const tag of html.match(meta) || []) {
    const match = tag.match(/content=["']([^"']+)["']/i);
    if (match) values.push(decodeCandidate(match[1]));
  }
  const patterns = [
    /"(?:playable_url_quality_hd|playable_url|browser_native_hd_url)"\\s*:\\s*"((?:https?:)?[^"]+)"/gi,
    /"src"\\s*:\\s*"(https?:\\\\?\\/\\\\?\/[^"]+\\.(?:mp4|m4a)[^"]*)"/gi
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) values.push(decodeCandidate(match[1]));
  }
  return [...new Set(values)].map(value => {
    try { return new URL(value, "https://www.facebook.com").toString(); } catch { return null; }
  }).filter(Boolean);
}

async function resolveFacebookVideo(rawUrl) {
  const pageUrl = validateFacebookPage(rawUrl);
  const page = await fetch(pageUrl.toString(), {
    redirect: "follow",
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; FacebookTranscriptExtractor/1.0)",
      "accept": "text/html,application/xhtml+xml"
    }
  });
  if (!page.ok) throw new Error("Facebook did not provide a publicly accessible page (HTTP " + page.status + ").");
  const finalPageUrl = new URL(page.url);
  if (!isFacebookHost(finalPageUrl.hostname.toLowerCase())) {
    throw new Error("Facebook redirected the link to an unsupported host.");
  }
  const html = await page.text();
  const candidate = findVideoCandidates(html).find(value => {
    try {
      const u = new URL(value);
      return u.protocol === "https:" && isFacebookHost(u.hostname.toLowerCase()) &&
        !u.hostname.endsWith(".facebook.com") &&
        !u.pathname.includes("/video/embed");
    } catch { return false; }
  });
  if (!candidate) {
    throw new Error("Could not find a direct video stream in Facebook's public page. The video may require login, have restricted visibility, or Facebook may have changed its page format.");
  }
  return candidate;
}

async function transcribeFacebook(rawUrl, env, language) {
  const videoUrl = await resolveFacebookVideo(rawUrl);
  const video = await fetch(videoUrl, {
    redirect: "follow",
    headers: { "user-agent": "Mozilla/5.0" }
  });
  if (!video.ok) throw new Error("The public video stream could not be downloaded (HTTP " + video.status + ").");
  const finalMediaUrl = new URL(video.url);
  if (!isFacebookHost(finalMediaUrl.hostname.toLowerCase())) {
    throw new Error("The video stream redirected to an unsupported host.");
  }
  const declaredSize = Number(video.headers.get("content-length") || 0);
  if (declaredSize > MAX_VIDEO_BYTES) throw new Error("Video exceeds the 100 MB processing limit.");
  const videoBytes = await video.arrayBuffer();
  if (videoBytes.byteLength > MAX_VIDEO_BYTES) throw new Error("Video exceeds the 100 MB processing limit.");

  const mediaResponse = await env.MEDIA.input(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(videoBytes));
      controller.close();
    }
  })).transform().output({ mode: "audio", duration: "10m" }).response();

  if (!mediaResponse.ok) throw new Error("Cloudflare could not extract audio from this video.");
  const audioBytes = await mediaResponse.arrayBuffer();
  if (audioBytes.byteLength > MAX_AUDIO_BYTES) throw new Error("Extracted audio exceeds the 25 MB transcription limit.");

  const options = { audio: Array.from(new Uint8Array(audioBytes)) };
  if (language) options.source_lang = language;
  const result = await env.AI.run(MODEL, options);
  return {
    source_url: rawUrl,
    transcript: result.text || "",
    vtt: result.vtt || "",
    word_count: result.word_count || 0,
    words: result.words || [],
    method: "facebook_public_video_to_cloudflare_whisper"
  };
}

function openApi(origin) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Facebook Transcript Extractor",
      version: "2.0.0",
      description: "Transcribe publicly accessible Facebook videos and Reels. Does not bypass login, privacy controls, DRM, or access restrictions."
    },
    servers: [{ url: origin }],
    paths: {
      "/health": { get: { operationId: "healthCheck", summary: "Check service status", responses: { "200": { description: "Service is online" } } } },
      "/transcribe": {
        post: {
          operationId: "transcribeFacebookVideo",
          summary: "Transcribe a public Facebook video or Reel",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["facebook_url"],
                  properties: {
                    facebook_url: { type: "string", format: "uri", description: "Public Facebook video, Reel, or fb.watch URL" },
                    language: { type: "string", description: "Optional source language code, for example en" }
                  }
                }
              }
            }
          },
          responses: {
            "200": { description: "Transcript and word timestamps" },
            "400": { description: "Invalid request" },
            "422": { description: "Video is not publicly accessible or extraction failed" },
            "500": { description: "Transcription service error" }
          }
        }
      }
    }
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin") || "*";
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type, authorization",
          "access-control-max-age": "86400"
        }
      });
    }

    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ status: "ok", service: "facebook-transcript-extractor", model: MODEL }, 200, origin);
    }
    if (url.pathname === "/openapi.json" && request.method === "GET") {
      return json(openApi(url.origin), 200, origin);
    }
    if (url.pathname !== "/transcribe" || request.method !== "POST") {
      return json({ error: "Not found" }, 404, origin);
    }

    let body;
    try { body = await request.json(); }
    catch { return json({ error: "Request body must be valid JSON." }, 400, origin); }

    if (!body || typeof body.facebook_url !== "string") {
      return json({ error: "facebook_url is required." }, 400, origin);
    }

    try {
      const result = await transcribeFacebook(body.facebook_url, env, body.language || null);
      return json(result, 200, origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected transcription error.";
      const status = /valid Facebook|Only public|facebook_url/i.test(message) ? 400 :
        /publicly accessible|Could not find|login|restricted|100 MB|25 MB/i.test(message) ? 422 : 500;
      return json({ error: message }, status, origin);
    }
  }
};
