FROM node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates=20230311+deb12u1 \
    ffmpeg=7:5.1.9-0+deb12u1 \
    fonts-dejavu-core=2.37-6 \
    python3-venv=3.11.2-1+b1 \
    tini=0.19.0-1+b3 \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /opt/piper \
  && mkdir -p /runtime/tts/models /runtime/tts/fonts /runtime/tts/cache \
  && chown -R node:node /runtime

WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
  && npm cache clean --force
COPY deploy/worker/requirements.lock /tmp/requirements.lock
RUN /opt/piper/bin/pip install --no-cache-dir --requirement /tmp/requirements.lock \
  && rm /tmp/requirements.lock
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node shared ./shared
COPY --chown=node:node schema ./schema
COPY --chown=node:node public ./public
COPY --chown=node:node pilots ./pilots

USER node
ENTRYPOINT ["/usr/bin/tini", "--", "node", "scripts/worker/linux-portability-probe.mjs"]
