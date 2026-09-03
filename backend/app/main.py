from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import ai, companies, notes, prices

app = FastAPI(title="S&P 500 Tracker API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(companies.router)
app.include_router(prices.router)
app.include_router(notes.router)
app.include_router(ai.router)


@app.get("/health")
def health():
    return {"status": "ok"}
