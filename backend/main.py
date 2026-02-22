"""
backend/main.py — Entry-point shim.

The full application now lives in api/main.py.
This file exists solely so that `uvicorn main:app` continues to work.
"""

from api.main import app  # noqa: F401

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
