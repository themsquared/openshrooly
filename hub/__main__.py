from .app import app
from . import config

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=config.HOST,
        port=config.PORT,
        proxy_headers=config.TRUST_FORWARDED,
    )
