#!/usr/bin/env python3
"""OneBook OCR worker (3.0.3).

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
import math
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

if not os.environ.get("ONEBOOK_URL") or not os.environ.get("OCR_WORKER_SECRET"):
    sys.exit("ONEBOOK_URL and OCR_WORKER_SECRET must both be set (see /etc/onebook-ocr.env).")

VERSION = "onebook-ocr-worker/1"
ONEBOOK = os.environ["ONEBOOK_URL"].rstrip("/")
SECRET = os.environ["OCR_WORKER_SECRET"]
VLLM = os.environ.get("VLLM_URL", "http://127.0.0.1:8000").rstrip("/")
MAX_PAGES = 20
MAX_DOWNLOAD = 20 * 1024 * 1024
IDLE_SECONDS = 30
BUSY_SECONDS = 5
BUSY_WINDOW = 15 * 60
SUFFIX = {"application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg"}


class Unreadable(Exception):
    """A reason the person who asked can act on."""


def onebook(action, **fields):
    req = urllib.request.Request(
        f"{ONEBOOK}/api/ocr/worker",
        json.dumps({"action": action, **fields}, ensure_ascii=False).encode("utf-8"),
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


def count_pages(source, mime):
    if mime != "application/pdf":
        return 1
    count = page_count(source)
    if count < 1:
        raise Unreadable("The PDF has no pages.")
    if count > MAX_PAGES:
        raise Unreadable(f"The file has {count} pages; OCR reads at most {MAX_PAGES}.")
    return count


def render_dpi(pdfinfo_text):
    """Keep ordinary pages at 300 dpi and cap the largest page (of the first 20) near 3300 px."""
    sizes = re.findall(r"^Page\s+\d+\s+size:\s+([\d.]+) x ([\d.]+) pts", pdfinfo_text, re.MULTILINE)
    if not sizes:
        sizes = re.findall(r"Page size:\s+([\d.]+) x ([\d.]+) pts", pdfinfo_text)
    if not sizes:
        return 300
    long_side = max(max(float(w), float(h)) for w, h in sizes) / 72
    # 12 in is 3600 px at 300 dpi, so A4 (11.7 in) stays at 300
    if long_side <= 12:
        return 300
    return max(100, math.floor(3300 / long_side))


def images_of(source, mime, workdir):
    if mime != "application/pdf":
        return [source]
    info = subprocess.run(["pdfinfo", "-f", "1", "-l", str(MAX_PAGES), str(source)], capture_output=True, text=True, timeout=60).stdout
    dpi = render_dpi(info)
    subprocess.run(["pdftoppm", "-r", str(dpi), "-png", str(source), str(workdir / "page")], check=True, timeout=300)
    images = sorted(workdir.glob("page-*.png"))
    if not images:
        raise Unreadable("The PDF has no pages.")
    return images


def download(url, target):
    size = 0
    with urllib.request.urlopen(url, timeout=60) as resp, open(target, "wb") as out:
        while True:
            chunk = resp.read(64 * 1024)
            if not chunk:
                return
            size += len(chunk)
            if size > MAX_DOWNLOAD:
                raise Unreadable("The file is larger than 20 MB.")
            out.write(chunk)


def report(job_id, done, total):
    """True while the job is still ours. A failed call must not kill a long job, so only an explicit ok:false stops it."""
    try:
        answer = onebook("progress", id=job_id, pagesDone=done, pagesTotal=total)
    except Exception as error:
        print(f"job {job_id} progress report failed: {type(error).__name__}", flush=True)
        return True
    if isinstance(answer, dict) and answer.get("ok") is False:
        print(f"job {job_id} is no longer ours; stopping", flush=True)
        return False
    return True


def cut_page(text):
    """Cut to 100,000 UTF-16 code units, the way OneBook counts, without splitting a character."""
    return text.encode("utf-16-le")[: 2 * 100_000].decode("utf-16-le", "ignore")


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
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.load(resp)["choices"][0]["message"]["content"]


def work(job):
    with tempfile.TemporaryDirectory() as tmp:
        workdir = pathlib.Path(tmp)
        source = workdir / ("source" + SUFFIX.get(job["mimeType"], ".bin"))
        download(job["downloadUrl"], source)
        # report as soon as the page count is known: rendering can take minutes and the lease is 10
        total = count_pages(source, job["mimeType"])
        if not report(job["id"], 0, total):
            return False
        images = images_of(source, job["mimeType"], workdir)
        pages = []
        for n, image in enumerate(images, 1):
            # OneBook accepts at most 100,000 characters a page; cut here so one runaway page cannot fail the whole job
            pages.append({"page": n, "text": cut_page(read_page(image))})
            if not report(job["id"], n, len(images)):
                return False
        answer = onebook("complete", id=job["id"], result={"engine": VERSION + "+unlimited-ocr", "pages": pages})
        return not (isinstance(answer, dict) and answer.get("ok") is False)


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
            if work(job):
                print(f"job {job['id']} read in {time.monotonic() - started:.0f} s", flush=True)
            else:
                print(f"job {job['id']} abandoned: no longer ours", flush=True)
        except Exception as error:
            reason = str(error) if isinstance(error, Unreadable) else "The OCR server could not read this file."
            # these carry a status or a command line, never the file's text; anything else is the class name only
            known = (Unreadable, urllib.error.HTTPError, urllib.error.URLError, subprocess.TimeoutExpired, subprocess.CalledProcessError)
            detail = str(error) if isinstance(error, known) else type(error).__name__
            print(f"job {job['id']} failed: {detail}", flush=True)
            try:
                onebook("fail", id=job["id"], error=reason)
            except Exception:
                pass  # the lease runs out and the job is handed out again


if __name__ == "__main__":
    main()
