"""FastAPI application factory.

Kept small: exception handlers, CORS, a health check, router registration,
and a lifespan that closes long-lived HTTP clients so the process exits fast
on Render's periodic restarts.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import settings
from .errors import (
    ApiError,
    handle_api_error,
    handle_http_exception,
    handle_unexpected,
    handle_validation_error,
)
from .routers import (
    documents,
    flashcards,
    me,
    notes,
    quizzes,
    skills,
    spaces,
    subspace_chat,
    subspaces,
)
from .services import llm, supabase


logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    await supabase.close_client()
    await llm.close_llm()


def create_app() -> FastAPI:
    app = FastAPI(
        title="Space Learn API",
        version="0.1.0",
        docs_url="/api/v1/docs",
        openapi_url="/api/v1/openapi.json",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Order matters: specific → generic.
    app.add_exception_handler(ApiError, handle_api_error)
    app.add_exception_handler(RequestValidationError, handle_validation_error)
    app.add_exception_handler(StarletteHTTPException, handle_http_exception)
    app.add_exception_handler(Exception, handle_unexpected)

    prefix = "/api/v1"
    app.include_router(me.router, prefix=prefix, tags=["me"])
    app.include_router(spaces.router, prefix=prefix, tags=["spaces"])
    app.include_router(subspaces.router, prefix=prefix, tags=["subspaces"])
    app.include_router(subspace_chat.router, prefix=prefix, tags=["chat"])
    app.include_router(documents.router, prefix=prefix, tags=["documents"])
    app.include_router(notes.router, prefix=prefix, tags=["notes"])
    app.include_router(flashcards.router, prefix=prefix, tags=["flashcards"])
    app.include_router(quizzes.router, prefix=prefix, tags=["quizzes"])
    app.include_router(skills.router, prefix=prefix, tags=["skills"])

    @app.get(f"{prefix}/health", tags=["health"])
    async def health() -> dict[str, object]:
        return {
            "ok": True,
            "supabase": settings.supabase_configured,
            "llm": settings.llm_configured,
        }

    return app


app = create_app()
