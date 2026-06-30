from fastapi import APIRouter, UploadFile, File, Form, HTTPException
import httpx
import logging

logger = logging.getLogger("uvicorn.error")
router = APIRouter()

SENSEVOICE_API_URL = "http://172.19.0.1:8082/transcribe"

@router.post("/transcribe", tags=["SenseVoice"])
async def transcribe_route(
    audio: UploadFile = File(...),
    language: str = Form("yue"),
):
    """
    Forward audio transcription request to local SenseVoice API.
    Resolves any Cloudflare/CORS block by routing through the main API domain.
    """
    try:
        # Read uploaded file content
        audio_content = await audio.read()
        
        # Prepare multipart/form-data for local SenseVoice endpoint
        files = {"audio": (audio.filename or "chunk.wav", audio_content, audio.content_type or "audio/wav")}
        data = {"language": language}
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(SENSEVOICE_API_URL, files=files, data=data)
            
        if resp.status_code != 200:
            logger.error(f"Local SenseVoice returned status {resp.status_code}: {resp.text}")
            raise HTTPException(
                status_code=resp.status_code,
                detail=f"Local SenseVoice error: {resp.text}"
            )
            
        return resp.json()
        
    except httpx.RequestError as exc:
        logger.error(f"Failed to connect to local SenseVoice API: {exc}")
        raise HTTPException(
            status_code=502,
            detail=f"SenseVoice API is unreachable: {str(exc)}"
        )
    except Exception as e:
        logger.exception("Transcription proxy route failed")
        raise HTTPException(status_code=500, detail=str(e))
