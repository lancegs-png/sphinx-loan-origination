# PDF converter (self-hosted)

The **PDF** download on the Templates tab (LOI, First Payment Letter, etc.) works by
generating the Word (`.docx`) file in the app, then converting it to PDF. The app can't
convert on Vercel — Vercel's servers can't run LibreOffice — so conversion is done by a
tiny service **you host**: [Gotenberg](https://gotenberg.dev), a maintained Docker image
that wraps LibreOffice behind an HTTP API.

The Word file stays the single source of truth. The PDF is a faithful render of it, so
there's **no second copy of the document to keep in sync**. Nothing is sent to any
third-party SaaS — the document only ever reaches the converter you own.

```
App (Vercel)  ──POST the .docx──►  Gotenberg (your Railway/Render service)  ──PDF──►  App
```

When `PDF_CONVERTER_URL` is **not** set, the app falls back to a local LibreOffice binary
(`soffice`) — handy for development (`brew install --cask libreoffice`), and the path used
before this change.

---

## 1. Deploy Gotenberg

Pick one host. Both cost a few dollars a month. Use a paid tier so the service doesn't
sleep — a sleeping service makes the first PDF after an idle period slow (cold start).

### Option A — Railway

1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy a Docker Image**.
2. Image: `gotenberg/gotenberg:8`.
3. Open the service → **Variables** and add:
   - `API_ENABLE_BASIC_AUTH` = `true`
   - `GOTENBERG_API_BASIC_AUTH_USERNAME` = *a username you choose*
   - `GOTENBERG_API_BASIC_AUTH_PASSWORD` = *a strong password you choose*
4. **Settings → Networking → Generate Domain.** Set the target **port to `3000`**
   (Gotenberg's default). Railway gives you a URL like
   `https://loan-pdf-converter-production.up.railway.app`.

### Option B — Render (Blueprint)

1. Make sure this repo is on GitHub.
2. [dashboard.render.com](https://dashboard.render.com) → **New +** → **Blueprint** → pick
   this repo. Render reads [`render.yaml`](./render.yaml) and creates the service from
   [`Dockerfile`](./Dockerfile).
3. After it deploys, open the service → **Environment** and set the two secrets:
   - `GOTENBERG_API_BASIC_AUTH_USERNAME` = *a username you choose*
   - `GOTENBERG_API_BASIC_AUTH_PASSWORD` = *a strong password you choose*

   (`API_ENABLE_BASIC_AUTH=true` is already set by the blueprint.)
4. Render gives you a URL like `https://loan-pdf-converter.onrender.com`.

> Without a Dockerfile you can also deploy on Render as **New + → Web Service → Deploy an
> existing image** with image `gotenberg/gotenberg:8` and HTTP port `3000`.

---

## 2. Lock it down

- **Always enable basic auth** (the env vars above). Without it, anyone who finds the URL
  can use your converter. With it, every conversion request must send the credentials;
  unauthenticated requests get `401`. The `/health` check stays open on purpose.
- Keep the image on the **`8`** tag (or newer patched releases) and redeploy periodically.
  Advisory **CVE-2026-55229** described an SSRF in the LibreOffice route on an older 8.x
  build; the `8` tag tracks patched releases. The app only ever sends its own generated
  documents (not attacker-supplied files), which further limits exposure.
- Don't put anything else on this host; it has one job.

### Verify it's up

```bash
# Health (no auth):
curl -fsS https://YOUR-CONVERTER-URL/health

# A real conversion (replace creds + file). Should write a non-empty out.pdf:
curl -fsS --user "USER:PASS" \
  --form "files=@sample.docx" \
  https://YOUR-CONVERTER-URL/forms/libreoffice/convert -o out.pdf
```

---

## 3. Point the app at it (Vercel env vars)

In the Vercel project → **Settings → Environment Variables**, add (Production, and
Preview if you want PDFs there too), then **redeploy**:

| Variable | Value | Notes |
|---|---|---|
| `PDF_CONVERTER_URL` | `https://YOUR-CONVERTER-URL` | The Railway/Render URL. **No trailing slash**, no path. |
| `PDF_CONVERTER_AUTH` | `Basic <base64>` | The `Authorization` header value. See below. Omit only if you left basic auth off (not recommended). |

Build the `PDF_CONVERTER_AUTH` value from the same username/password you set on the
converter:

```bash
# prints:  Basic dXNlcjpwYXNz
printf 'Basic %s' "$(printf '%s' 'USER:PASS' | base64)"
```

Paste the whole thing (the word `Basic`, a space, then the base64) as `PDF_CONVERTER_AUTH`.

That's it. After the Vercel redeploy, the **PDF** button on the Templates tab converts
through your service. If `PDF_CONVERTER_URL` is ever unset, the app simply reports that PDF
export isn't configured (the Word download always works regardless).

---

## How the app uses this

`src/lib/templates/pdf.ts`:
- `docxToPdf()` → `POST ${PDF_CONVERTER_URL}/forms/libreoffice/convert` (multipart field
  `files`), forwarding `PDF_CONVERTER_AUTH` as the `Authorization` header.
- `htmlToPdf()` (activity-log export) → `POST ${PDF_CONVERTER_URL}/forms/chromium/convert/html`.
- With no `PDF_CONVERTER_URL`, both fall back to a local `soffice`/`libreoffice` binary.
