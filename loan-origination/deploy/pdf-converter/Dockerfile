# Self-hosted PDF converter for the loan-origination app.
#
# Gotenberg is a maintained Docker image that wraps LibreOffice (+ Chromium) behind
# a small HTTP API. The app POSTs the generated .docx to it and gets back a PDF that
# is a faithful render of the Word file (no re-creation of the document).
#
# Pinned to the 8.x line, which receives security patches (see the advisory note in
# README.md). Bump the tag to adopt newer patch releases.
FROM gotenberg/gotenberg:8

# Gotenberg listens on 3000 by default. Railway and Render read this EXPOSE to route
# traffic; if your platform injects its own $PORT, set API_PORT to match instead.
EXPOSE 3000

# Basic auth (username/password) is enabled entirely through environment variables —
# API_ENABLE_BASIC_AUTH, GOTENBERG_API_BASIC_AUTH_USERNAME, GOTENBERG_API_BASIC_AUTH_PASSWORD
# — so the default entrypoint needs no override. See README.md.
