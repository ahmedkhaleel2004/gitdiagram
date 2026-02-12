import os

from api_analytics.fastapi import Analytics
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.errors import api_success
from app.core.observability import log_event
from app.routers import generate

app = FastAPI()

cors_origins = os.getenv("CORS_ORIGINS")
if cors_origins:
    origins = [origin.strip() for origin in cors_origins.split(",") if origin.strip()]
else:
    origins = [
        "http://localhost:3000",
        "https://gitdiagram.com",
        "https://www.gitdiagram.com",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

api_analytics_key = os.getenv("API_ANALYTICS_KEY")
if api_analytics_key:
    app.add_middleware(Analytics, api_key=api_analytics_key)

app.include_router(generate.router)


@app.get("/")
async def root():
    return api_success(message="Hello from GitDiagram API!")


@app.get("/healthz")
async def healthz():
    log_event("healthz.ok")
    return api_success(status="ok")
