# Document scanner

The malware-scanner gateway One Book expects. Until it is running and its URL
and token are configured, **One Book refuses every upload** — the drag area is
disabled, the server action refuses, and the nightly scan job returns 503. That
is deliberate: these files are customer accounting evidence, opened later by an
accountant.

Not deployed by Vercel. It lives outside `ctyhp-accounting/` and runs on your own
machine.

## What it is

Two containers and three files of Node standard library.

```
One Book ──POST bytes──▶ gateway ──INSTREAM──▶ clamd
         ◀──verdict────           ◀──OK / FOUND──
```

There are no npm dependencies. This is the component that decides whether a file
reaches an accountant; there is nothing here to audit but our own code.

## The contract

| | |
|---|---|
| **Request** | `POST` any path |
| | `authorization: Bearer <token>` |
| | `content-type:` the file's MIME type |
| | `x-document-name:` `encodeURIComponent(name)` — optional |
| | `x-document-sha256:` hex digest of the body — optional, verified when present |
| | body: raw file bytes, 10 MB ceiling |
| **Clean** | `200 {"verdict":"clean","engine":"ClamAV 1.4.x/27412/..."}` |
| **Blocked** | `200 {"verdict":"blocked","engine":"...","threat":"Eicar-Signature"}` |
| **Refused** | `401` `405` `413` `400` |
| **Cannot answer** | `503` |

A blocked verdict **must** carry a threat name — One Book's own schema rejects
the response otherwise.

### The rule everything else serves

**Nothing answers "clean" unless clamd said so.** An unreachable daemon, a
timeout, a reply the client does not recognise: every one is a 503, which One
Book records as `scan_status = 'error'` and retries up to five times. The file
stays unreadable in the meantime.

A scanner that fails open is worse than no scanner, because the screen then says
the file was checked.

## Deploying

### 1. Bring it up

Needs Docker and about **2 GB of memory for clamd** — it loads the whole
signature set. Below roughly 1.5 GB it is killed mid-scan, and the symptom is
"every scan fails", not "clamd is short of memory".

```bash
cd services/document-scanner
export SCANNER_TOKEN=$(openssl rand -hex 24)   # 48 hex chars; the floor is 24
docker compose up -d
docker compose logs -f clamav                  # wait for the first signature download
```

The first start downloads ~250 MB of signatures and takes a few minutes. The
volume keeps them, so restarts are quick.

### 2. Put TLS in front of it

The gateway listens on `127.0.0.1:8080` and speaks plain HTTP. One Book refuses a
`DOCUMENT_SCANNER_URL` that is neither `https:` nor localhost, and it is right
to: the request body is the customer's file.

Caddy is two lines:

```
scanner.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

nginx, Traefik or a Cloudflare tunnel do just as well. Do not publish port 8080.

### 3. Prove it actually scans

```bash
node smoke.mjs https://scanner.example.com "$SCANNER_TOKEN"
```

It sends a harmless file and then EICAR, the standard harmless test string every
scanner is required to flag. **A deployment that calls both clean is not scanning
anything**, and this is the check that catches it — the contract tests cannot,
because they run against a fake daemon rather than a signature database.

### 4. Tell One Book

Add to `ctyhp-accounting/.env.local` and to Vercel (Production and Preview):

```
DOCUMENT_SCANNER_URL=https://scanner.example.com
DOCUMENT_SCANNER_TOKEN=<the same SCANNER_TOKEN>
```

Also set `CRON_SECRET` (≥24 characters) in Vercel if it is not already there —
the nightly job at `/api/documents/scan` rescans anything that failed.

Restart the app. The banner in the attachments drawer turns from a warning into a
confirmation and the upload control comes alive.

## Keeping it honest

- `docker compose logs gateway` — one line per scan: digest prefix, size,
  verdict. **The file name and the bytes are never logged.** These are a
  customer's accounting records; a container log is not the place for
  "Invoice from Aurora Fine Jewelry.pdf".
- `curl -s http://127.0.0.1:8080/health` — clamd alive, and which signature
  version is loaded.
- Signatures update hourly inside the clamav container. If it cannot reach
  ClamAV's servers it keeps serving the last set it has; check
  `docker compose logs clamav` for freshclam errors.

## Testing this repository's half

```bash
node test/contract.test.mjs      # 17 checks, no Docker needed
```

The fake daemon in `test/fake-clamd.mjs` is written to `clamd(8)` rather than to
our client — a stub shaped like the code it tests proves only that the code
agrees with itself. It reassembles the length-prefixed chunks the way the daemon
does and answers in the daemon's own wording, including finding EICAR across a
64 KB chunk boundary.

What those tests do **not** prove is that ClamAV behaves as its manual says. That
is what `smoke.mjs` is for, and why step 3 above is not optional.
