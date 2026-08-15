# deploy/

Optional Presenton sidecar. The default AutoOffice path does not vendor or start Presenton.

## Pin

Clone [presenton/presenton](https://github.com/presenton/presenton) at
`b8426281ffd00708bab2974466ecb7c0dc43aed3` into the gitignored repo-root
directory `presenton-upstream/`:

```bash
cd ~/Polarisor/AutoOffice
git clone https://github.com/presenton/presenton.git presenton-upstream
git -C presenton-upstream checkout b8426281ffd00708bab2974466ecb7c0dc43aed3
```

Or skip the clone and use `ghcr.io/presenton/presenton:latest` by switching
`deploy/docker-compose.presenton.yml` to the commented `image:` line.

Runtime data stays in gitignored `/presenton-data/`.

## Compose

`docker-compose.presenton.yml` build context is `../presenton-upstream`
(Dockerfile.arm64). This is not the AutoOffice API. Persistent processes still
belong to PolarProcess; do not start this stack with a raw `docker compose up`.

AutoOffice reaches Presenton through `PRESENTON_URL` (default `http://127.0.0.1:5000`).
