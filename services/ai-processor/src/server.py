"""
AI Processor REST Service.

FastAPI server on port 3010 that provides:
  - POST /api/ner      — Named Entity Recognition
  - POST /api/embed    — Text embeddings
  - POST /api/process  — Combined NER + embedding
  - GET  /api/costs    — Today's cost and usage statistics
  - GET  /health       — Service health check

This service has NO database dependency — all state is in-memory.
"""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from src.config import PORT, OPENAI_API_KEY, OPENROUTER_API_KEY
from src.cost_tracker import CostTracker
from src.embeddings import EmbeddingRequest, EmbeddingResponse, run_embedding
from src.ner import NERRequest, NERResponse, run_ner
from src.openai_client import BudgetExceededError, OpenAIClient
from src.process import ProcessRequest, ProcessResponse, run_process

# ---------------------------------------------------------------------------
# Globals — initialised once at startup
# ---------------------------------------------------------------------------

cost_tracker = CostTracker()
openai_client = OpenAIClient(cost_tracker=cost_tracker)


# ---------------------------------------------------------------------------
# FastAPI lifespan
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: validate at least one API key is present
    if not OPENAI_API_KEY and not OPENROUTER_API_KEY:
        print("⚠️  No API keys configured — set OPENAI_API_KEY or OPENROUTER_API_KEY")
    yield
    # Shutdown: nothing to clean up (in-memory state)


# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="ArgentinaRadar AI Processor",
    description="NER, classification, and embeddings for Argentine news articles",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — allow all origins in development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Error handlers
# ---------------------------------------------------------------------------


@app.exception_handler(BudgetExceededError)
async def budget_exceeded_handler(request, exc):
    raise HTTPException(
        status_code=429,
        detail={
            "error": "budget_exceeded",
            "message": "Daily cost cap exceeded — try again tomorrow",
            "usage": cost_tracker.get_stats(),
        },
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.post("/api/ner", response_model=NERResponse)
async def ner_endpoint(req: NERRequest):
    """Extract named entities and classify article category."""
    try:
        result = await run_ner(openai_client, req.text)
    except BudgetExceededError:
        # Attempt fallback
        try:
            result = await run_ner(openai_client, req.text, use_fallback=True)
        except BudgetExceededError:
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "budget_exceeded",
                    "message": "Daily cost cap exceeded — try again tomorrow",
                    "usage": cost_tracker.get_stats(),
                },
            )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": "ner_failed", "message": str(exc)},
        )

    return NERResponse(
        entities=result["entities"],
        category=result["category"],
        tokens_used=result["tokens_used"],
        cost=result["cost"],
    )


@app.post("/api/embed", response_model=EmbeddingResponse)
async def embed_endpoint(req: EmbeddingRequest):
    """Generate vector embeddings for article texts."""
    try:
        result = await run_embedding(openai_client, req.texts)
    except BudgetExceededError:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "budget_exceeded",
                "message": "Daily cost cap exceeded — try again tomorrow",
                "usage": cost_tracker.get_stats(),
            },
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": "embedding_failed", "message": str(exc)},
        )

    return EmbeddingResponse(
        embeddings=result["embeddings"],
        tokens_used=result["tokens_used"],
        cost=result["cost"],
    )


@app.post("/api/process", response_model=ProcessResponse)
async def process_endpoint(req: ProcessRequest):
    """Run NER and embedding in parallel on an article."""
    try:
        result = await run_process(openai_client, req.title, req.summary, req.source)
    except BudgetExceededError:
        try:
            result = await run_process(
                openai_client, req.title, req.summary, req.source, use_fallback=True
            )
        except BudgetExceededError:
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "budget_exceeded",
                    "message": "Daily cost cap exceeded — try again tomorrow",
                    "usage": cost_tracker.get_stats(),
                },
            )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": "process_failed", "message": str(exc)},
        )

    return ProcessResponse(
        entities=result["entities"],
        category=result["category"],
        embedding=result["embedding"],
        tokens_used=result["tokens_used"],
        cost=result["cost"],
    )


@app.get("/api/costs")
async def get_costs():
    """Return today's cost and usage statistics."""
    return cost_tracker.get_stats()


@app.get("/api/costs/logs")
async def get_cost_logs(limit: int = 100):
    """Return recent cost log entries."""
    return {"logs": cost_tracker.get_logs(limit=limit)}


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "port": PORT,
        "api_keys_configured": {
            "openai": bool(OPENAI_API_KEY),
            "openrouter": bool(OPENROUTER_API_KEY),
        },
        "budget_cap_exceeded": cost_tracker.is_cap_exceeded(),
    }


# ---------------------------------------------------------------------------
# Entry point (for direct execution)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("src.server:app", host="0.0.0.0", port=PORT, reload=False)
