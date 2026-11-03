#!/usr/bin/env python3
"""OneBook OCR worker (3.02).

Asks OneBook for scanned statements to read, reads each page with the local
Unlimited-OCR server, and sends the text back. Outbound HTTPS only; nothing
listens. Standard library plus poppler (pdftoppm, pdfinfo).

Environment, from /etc/onebook-ocr.env (root-only, never in the repo):
  ONEBOOK_URL        https://<the OneBook deployment>
  OCR_WORKER_SECRET  the same secret as OneBook's OCR_WORKER_SECRET
  VLLM_URL           default http://127.0.0.1:8000
"""
import base64
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time
import urllib.request

if not os.environ.get("ONEBOOK_URL") or not os.environ.get("OCR_WORKER_SECRET"):
    sys.exit("ONEBOOK_URL and OCR_WORKER_SECRET must both be set (see /etc/onebook-ocr.env).")

VERSION = "onebook-ocr-worker/1"
ONEBOOK = os.environ["ONEBOOK_URL"].rstrip("/")
SECRET = os.environ["OCR_WORKER_SECRET"]
VLLM = os.environ.get("VLLM_URL", "http://127.0.0.1:8000").rstrip("/")
MAX_PAGES = 20
IDLE_SECONDS = 30
BUSY_SECONDS = 5
BUSY_WINDOW = 15 * 60
SUFFIX = {"application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg"}


class Unreadable(Exception):
    """A reason the person who asked can act on."""


def onebook(action, **fields):
    req = urllib.request.Request(
        f"{ONEBOOK}/api/ocr/worker",
        json.dumps({"action": action, **fields}).encode(),
        {"Content-Type": "application/json", "Authorization": f"Bearer {SECRET}"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return None if resp.status == 204 else json.load(resp)


def page_count(pdf):
    try:
        out = subprocess.run(["pdfinfo", str(pdf)], check=True, capture_output=True, text=True, timeout=60).stdout
    except subprocess.CalledProcessError:
        raise Unreadable("The PDF could not be opened; it may be locked with a password or damaged.")
    for line in out.splitlines():
        if line.startswith("Pages:"):
            return int(line.split()[1])
    raise Unreadable("The PDF could not be opened; it may be damaged.")


def images_of(source, mime, workdir):
    if mime != "application/pdf":
        return [source]
    count = page_count(source)
    if count > MAX_PAGES:
        raise Unreadable(f"The file has {count} pages; OCR reads at most {MAX_PAGES}.")
    subprocess.run(["pdftoppm", "-r", "300", "-png", str(source), str(workdir / "page")], check=True, timeout=600)
    return sorted(workdir.glob("page-*.png"))


def read_page(image):
    mime = "image/png" if image.suffix == ".png" else "image/jpeg"
    data = base64.b64encode(image.read_bytes()).decode()
    body = {
        "model": "baidu/Unlimited-OCR",
        "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{data}"}},
            {"type": "text", "text": "<image>document parsing."},
        ]}],
        "temperature": 0,
        "skip_special_tokens": False,
        "vllm_xargs": {"ngram_size": 35, "window_size": 128},
    }
    req = urllib.request.Request(f"{VLLM}/v1/chat/completions", json.dumps(body).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as resp:
        return json.load(resp)["choices"][0]["message"]["content"]


def work(job):
    with tempfile.TemporaryDirectory() as tmp:
        workdir = pathlib.Path(tmp)
        source = workdir / ("source" + SUFFIX.get(job["mimeType"], ".bin"))
        urllib.request.urlretrieve(job["downloadUrl"], source)
        images = images_of(source, job["mimeType"], workdir)
        onebook("progress", id=job["id"], pagesDone=0, pagesTotal=len(images))
        pages = []
        for n, image in enumerate(images, 1):
            # OneBook accepts at most 100,000 characters a page; cut here so one runaway page cannot fail the whole job
            pages.append({"page": n, "text": read_page(image)[:100_000]})
            onebook("progress", id=job["id"], pagesDone=n, pagesTotal=len(images))
        onebook("complete", id=job["id"], result={"engine": VERSION + "+unlimited-ocr", "pages": pages})


def main():
    busy_until = 0.0
    print(f"{VERSION} asking {ONEBOOK} for work", flush=True)
    while True:
        try:
            answer = onebook("claim", version=VERSION)
        except Exception as error:  # OneBook unreachable: try again later
            print(f"claim failed: {error}", flush=True)
            time.sleep(IDLE_SECONDS)
            continue
        job = answer and answer.get("job")
        if not job:
            time.sleep(BUSY_SECONDS if time.monotonic() < busy_until else IDLE_SECONDS)
            continue
        busy_until = time.monotonic() + BUSY_WINDOW
        started = time.monotonic()
        try:
            work(job)
            print(f"job {job['id']} read in {time.monotonic() - started:.0f} s", flush=True)
        except Exception as error:
            reason = str(error) if isinstance(error, Unreadable) else "The OCR server could not read this file."
            print(f"job {job['id']} failed: {type(error).__name__}", flush=True)  # never the file's text
            try:
                onebook("fail", id=job["id"], error=reason)
            except Exception:
                pass  # the lease runs out and the job is handed out again


if __name__ == "__main__":
    main()
