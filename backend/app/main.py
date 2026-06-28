from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.routes.cleanup import router as cleanup_router
from app.routes.debug import router as debug_router
from app.routes.token import router as token_router

app = FastAPI(
    title="AITyping Backend API",
    description="iPhone-first PWA 智能語音輸入後端引擎",
    version="0.1.0",
)

# CORS Middleware 設定
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 註冊 API 路由
app.include_router(cleanup_router, prefix="/api")
app.include_router(token_router, prefix="/api")
app.include_router(debug_router, prefix="/api")


@app.get("/health", tags=["Health"])
async def health_check():
    """系統健康檢查端點"""
    return {
        "status": "healthy",
        "mock_mode": settings.MOCK_MODE,
        "live_model": settings.GEMINI_LIVE_MODEL,
        "cleanup_model": settings.GEMINI_CLEANUP_MODEL,
    }
