from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.routers import generate, modify
from app.core.limiter import limiter
from typing import cast
from starlette.exceptions import ExceptionMiddleware
from api_analytics.fastapi import Analytics
import os


app = FastAPI()


origins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:3003",
    "https://gitdiagram.com",
]

codespace_name = os.getenv("CODESPACE_NAME")
codespace_domain = os.getenv("GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN")
if codespace_name and codespace_domain:
    for port in range(3000, 3011):
        origins.append(f"https://{codespace_name}-{port}.{codespace_domain}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

API_ANALYTICS_KEY = os.getenv("API_ANALYTICS_KEY")
if API_ANALYTICS_KEY:
    app.add_middleware(Analytics, api_key=API_ANALYTICS_KEY)

app.state.limiter = limiter
app.add_exception_handler(
    RateLimitExceeded, cast(ExceptionMiddleware, _rate_limit_exceeded_handler)
)

app.include_router(generate.router)
app.include_router(modify.router)


@app.get("/")
# @limiter.limit("100/day")
async def root(request: Request):
    return {"message": "Hello from GitDiagram API!"}
