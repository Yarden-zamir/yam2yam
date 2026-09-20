FROM python:3.12-slim
RUN pip install --no-cache-dir pillow==11.* pillow-heif==0.22.*
WORKDIR /app
COPY app.py .
ENV LOG_DATA=/data PORT=8080
EXPOSE 8080
CMD ["python", "-u", "app.py"]
