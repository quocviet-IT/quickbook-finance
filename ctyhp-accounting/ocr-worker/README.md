# OneBook OCR worker

Runs on the company's OCR machine next to the vLLM container serving Unlimited-OCR
(model name `baidu/Unlimited-OCR`, listening on 127.0.0.1:8000). It only calls out:
OneBook's `/api/ocr/worker` and the local vLLM server.

Install (as an administrator on the OCR machine):

```bash
sudo apt install -y poppler-utils
sudo mkdir -p /opt/onebook-ocr && sudo cp worker.py /opt/onebook-ocr/
sudo install -m 600 /dev/null /etc/onebook-ocr.env
sudoedit /etc/onebook-ocr.env   # ONEBOOK_URL=..., OCR_WORKER_SECRET=..., VLLM_URL=http://127.0.0.1:8000
sudo cp onebook-ocr.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now onebook-ocr
journalctl -u onebook-ocr -f   # "asking https://... for work"
```

The secret is generated once (`openssl rand -hex 32`) and set in two places only:
this file and the Vercel project's `OCR_WORKER_SECRET`. Rotating it means changing both.
