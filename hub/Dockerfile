FROM python:3.12-slim
WORKDIR /app
COPY shared /app/shared
COPY data /app/data
COPY hub /app/hub
RUN pip install --no-cache-dir -r /app/hub/requirements.txt
ENV PYTHONPATH=/app/shared
ENV HUB_DATA_DIR=/app/hub/data
ENV OPENSHROOLY_DATA_DIR=/app/data
EXPOSE 8090
CMD ["python", "-m", "uvicorn", "hub.app:app", "--host", "0.0.0.0", "--port", "8090"]
