"""
AI Processor REST Service.

FastAPI server on port 3013 that provides:
  - POST /api/ner               — Named Entity Recognition
  - POST /api/embed             — Text embeddings
  - POST /api/process           — Combined NER + embedding
  - POST /api/filter            — Article relevance classification (PUBLISH/DISCARD)
  - POST /api/political/analyze — Political figure + sentiment extraction
  - POST /api/security/classify — Security/crime category classification
  - POST /api/protest/classify  — Protest/corte content classification
  - GET  /api/costs             — Today's cost and usage statistics
  - GET  /api/costs/logs        — Recent cost log entries
  - GET  /health                — Service health check

The filter endpoint has an optional database dependency for persisting
verdicts (DB_PATH config). All other state is in-memory.
"""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from src.config import AI_MODE, LOCAL_MODELS, PORT, OPENAI_API_KEY, OPENROUTER_API_KEY
from src.cost_tracker import CostTracker
from src.embeddings import EmbeddingRequest, EmbeddingResponse, run_embedding
from src.filter import FilterRequest, FilterResponse, run_filter
from src.images import ImageRequest, ImageResponse, run_image_generation
from src.ner import NERRequest, NERResponse, run_ner
from src.openai_client import BudgetExceededError, OpenAIClient
from src.political import (
    PoliticalAnalysisRequest,
    PoliticalAnalysisResponse,
    run_political_analysis,
)
from src.process import ProcessRequest, ProcessResponse, run_process
from src.security import SecurityClassifyRequest, SecurityClassifyResponse, run_security_classify
from src.protest import ProtestClassifyRequest, ProtestClassifyResponse, run_protest_classify
from src.translate import (
    TranslateRequest,
    TranslateResponse,
    translate_to_spanish,
)

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
    # Startup: validate configuration
    if AI_MODE == "local":
        print("[AI] AI mode: LOCAL — using Ollama (zero cost, no API keys needed)")
        print(f"[AI]    Models: fast={LOCAL_MODELS.get('fast')}, smart={LOCAL_MODELS.get('smart')}, embed={LOCAL_MODELS.get('embed')}")
    elif AI_MODE == "hybrid":
        print("[AI] AI mode: HYBRID — Ollama by default, fallback to paid API")
        if not OPENAI_API_KEY and not OPENROUTER_API_KEY:
            print("[AI]  Hybrid mode requires at least one API key for fallback")
    elif not OPENAI_API_KEY and not OPENROUTER_API_KEY:
        print("[AI]  No API keys configured — set OPENAI_API_KEY or OPENROUTER_API_KEY")
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


@app.post("/api/political/analyze", response_model=PoliticalAnalysisResponse)
async def political_analyze_endpoint(req: PoliticalAnalysisRequest):
    """Extract political figures and sentiment from article text."""
    try:
        result = await run_political_analysis(openai_client, req.text)
    except BudgetExceededError:
        try:
            result = await run_political_analysis(
                openai_client, req.text, use_fallback=True
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
            detail={"error": "political_analysis_failed", "message": str(exc)},
        )

    return PoliticalAnalysisResponse(
        figures=result["figures"],
        summary=result["summary"],
        tokens_used=result["tokens_used"],
        cost=result["cost"],
    )


@app.post("/api/filter", response_model=FilterResponse)
async def filter_endpoint(req: FilterRequest):
    """Classify article relevance and return PUBLISH/DISCARD verdict."""
    try:
        result = await run_filter(
            openai_client,
            article_id=req.article_id,
            title=req.title,
            summary=req.summary,
            source=req.source,
            category=req.category,
        )
    except BudgetExceededError:
        try:
            result = await run_filter(
                openai_client,
                article_id=req.article_id,
                title=req.title,
                summary=req.summary,
                source=req.source,
                category=req.category,
                use_fallback=True,
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
            detail={"error": "filter_failed", "message": str(exc)},
        )

    return FilterResponse(
        article_id=result["article_id"],
        verdict=result["verdict"],
        reason=result["reason"],
        scores=result["scores"],
        combined=result["combined"],
        tokens_used=result["tokens_used"],
        cost=result["cost"],
    )


@app.post("/api/security/classify", response_model=SecurityClassifyResponse)
async def security_classify_endpoint(req: SecurityClassifyRequest):
    """Classify article text into a security/crime category."""
    try:
        result = await run_security_classify(openai_client, req.text)
    except BudgetExceededError:
        try:
            result = await run_security_classify(
                openai_client, req.text, use_fallback=True
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
            detail={"error": "security_classify_failed", "message": str(exc)},
        )

    return SecurityClassifyResponse(
        security_category=result["security_category"],
        confidence=result["confidence"],
        tokens_used=result["tokens_used"],
        cost=result["cost"],
    )


@app.post("/api/protest/classify", response_model=ProtestClassifyResponse)
async def protest_classify_endpoint(req: ProtestClassifyRequest):
    """Classify article text for protest/corte content."""
    try:
        result = await run_protest_classify(openai_client, req.text)
    except BudgetExceededError:
        try:
            result = await run_protest_classify(
                openai_client, req.text, use_fallback=True
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
            detail={"error": "protest_classify_failed", "message": str(exc)},
        )

    return ProtestClassifyResponse(
        is_protest=result["is_protest"],
        protest_type=result["protest_type"],
        route=result["route"],
        km=result["km"],
        location=result["location"],
        estimated_duration_hours=result["estimated_duration_hours"],
        confidence=result["confidence"],
        tokens_used=result["tokens_used"],
        cost=result["cost"],
    )


@app.post("/api/image/generate", response_model=ImageResponse)
async def image_generate_endpoint(req: ImageRequest):
    """Generate a news-themed image for a tweet draft."""
    try:
        result = await run_image_generation(
            openai_client,
            title=req.title,
            style=req.style,
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
            detail={"error": "image_generation_failed", "message": str(exc)},
        )

    return ImageResponse(
        image_url=result["image_url"],
        prompt_used=result["prompt_used"],
        model=result["model"],
        cost=result["cost"],
    )


@app.post("/api/translate", response_model=TranslateResponse)
async def translate_endpoint(req: TranslateRequest):
    """Translate non-Spanish text into Spanish using Google or OpenAI."""
    try:
        result = await translate_to_spanish(
            text=req.text,
            source=req.source,
            provider=req.provider,
            openai_client=openai_client,
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
            detail={
                "error": "translation_failed",
                "message": str(exc),
            },
        )

    return TranslateResponse(
        translated_text=result.translated_text,
        detected_language=result.detected_language,
        provider=result.provider,
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
        "ai_mode": AI_MODE,
        "api_keys_configured": {
            "openai": bool(OPENAI_API_KEY),
            "openrouter": bool(OPENROUTER_API_KEY),
        },
        "ollama_models": list(LOCAL_MODELS.values()),
        "budget_cap_exceeded": cost_tracker.is_cap_exceeded(),
    }


# ---------------------------------------------------------------------------
# Entry point (for direct execution)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("src.server:app", host="0.0.0.0", port=PORT, reload=False)
