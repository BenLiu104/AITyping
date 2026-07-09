import asyncio
import sys
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.gemini.adapter import GeminiAdapter  # noqa: E402


def _safe_token_prefix(token: str) -> str:
    if not token:
        return ""
    return token[:12]


async def main() -> int:
    try:
        adapter = GeminiAdapter()
        token_data = await adapter.generate_ephemeral_token()
    except Exception as exc:
        print(f"FAILED {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    token = str(token_data["token"])
    print("Gemini Live ephemeral token verification succeeded")
    print(f"token_prefix: {_safe_token_prefix(token)}")
    print(f"token_length: {len(token)}")
    print(f"expiresAt: {token_data['expiresAt']}")
    print(f"model: {token_data['model']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
