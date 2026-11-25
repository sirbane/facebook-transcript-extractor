"""MCP interface for the Facebook Transcript Extractor REST service."""
import os
import httpx
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP

load_dotenv()

API_BASE_URL = os.getenv("API_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
API_KEY = os.getenv("API_KEY", "").strip()
mcp = FastMCP(
    "Facebook Transcript Extractor",
    instructions=(
        "Transcribe publicly accessible Facebook videos, Reels, and video posts. "
        "Never claim to access private or login-restricted content. "
        "Only process content the user is authorized to use."
    ),
    host=os.getenv("MCP_HOST", "0.0.0.0"),
    port=int(os.getenv("MCP_PORT", "8001")),
)


@mcp.tool()
def transcribe_facebook_video(
    facebook_url: str,
    language: str | None = None,
    timestamps: bool = True,
) -> dict:
    """Return the transcript of a publicly accessible Facebook video or Reel."""
    headers = {"Authorization": f"Bearer {API_KEY}"} if API_KEY else {}
    try:
        response = httpx.post(
            f"{API_BASE_URL}/transcribe",
            json={
                "facebook_url": facebook_url,
                "language": language,
                "timestamps": timestamps,
            },
            headers=headers,
            timeout=900.0,
        )
        response.raise_for_status()
        return response.json()
    except httpx.HTTPStatusError as exc:
        return {"error": exc.response.text, "status_code": exc.response.status_code}
    except httpx.HTTPError as exc:
        return {"error": f"Transcript service unavailable: {exc}"}


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
