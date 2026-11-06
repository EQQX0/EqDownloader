# Phone server

Files for the Android phone that answers YouTube links for the website. They run in Termux.

| File | Goes to | What it does |
|---|---|---|
| `eq_server.py` | `~/eq/eq_server.py` | The API behind `downloader.eqqx2.com`: `/api/probe`, `/api/dl`, `/api/merge`. Runs under uvicorn on 127.0.0.1:8082. |
| `start-all.sh` | `~/.termux/boot/` | Starts nginx, uvicorn and the tunnel at boot. |
| `nginx.conf` | nginx config | Serves the static site and proxies `/api` to port 8082. |

Settings, as environment variables: `EQ_CORS_ORIGINS` (sites allowed to call the probe, default `https://eqdownload.vercel.app,https://download.eqqx2.com`), `EQ_PROBE_TTL` (seconds a probe result is kept, default 600), `EQ_CACHE` (yt-dlp cache folder).

The phone's clock must be on automatic time. A wrong clock makes YouTube fail with an SSL error.

When YouTube stops working, update yt-dlp: `pip install -U yt-dlp yt-dlp-ejs`.

The Cloudflare Tunnel credentials file stays on the phone and is not stored here.
