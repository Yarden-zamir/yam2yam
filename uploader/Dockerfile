FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*  # videos: remade for the web, a poster frame
RUN pip install --no-cache-dir pillow==11.* pillow-heif==0.22.*
WORKDIR /app
COPY app.py .
ENV LOG_DATA=/data PORT=8080
EXPOSE 8080
CMD ["python", "-u", "app.py"]
