# Third-party references and data

## NapCat QQ face labels

`src/qq-faces.json` contains only the factual QQ face ID/name pairs extracted from the installed NapCat face configuration on 2026-10-20 (329 entries). It includes no QQ image assets, NapCat executable, or NapCat implementation code. The runtime prefers the label supplied by QQ in `raw.faceText`, so newer labels can work without updating this snapshot.

Source: [NapNeko/NapCatQQ](https://github.com/NapNeko/NapCatQQ), Copyright © 2024 Mlikiowa. The upstream license is preserved in [licenses/NapCat.txt](licenses/NapCat.txt). This project does not grant additional rights to upstream components.

## Authentication protocol reference

The school CAS / UCloud request flow was checked against [byrdocs/bupt-auth](https://github.com/byrdocs/bupt-auth) (MIT). This project's implementation is separate; it does not bundle that project's code or any CAPTCHA OCR service.

## Group conversation design reference

The group background window, sender identification and quote/mention reply design were checked against the official [AstrBot configuration documentation](https://docs.astrbot.app/en/dev/astrbot-config.html). The implementation here is independent JavaScript; no AstrBot source code is bundled. Prompt structure was checked against [OpenAI's prompt engineering guide](https://developers.openai.com/api/docs/guides/prompt-engineering).

## NapCat configuration extension

The integration uses NapCat's authenticated plugin router, native HTML config schema and lifecycle APIs. This repository ships its own bridge and configuration frontend, not NapCat frontend assets. Five fixed module IDs are listed in `napcat-plugin/catalog.mjs`; an explicitly selected compatibility patch trusts only those IDs in builds with a hardcoded official-plugin list, preserving sensitive-word checks and all other plugin restrictions. Native configuration embeds the shared UI without registering separate extension pages. NapCat's license is retained under `licenses/NapCat.txt`. Notice monitoring uses the separately installed QQ Chat Exporter plugin; no exporter implementation is bundled here.

## Runtime dependencies

npm dependencies are listed in `package.json` and locked in `package-lock.json`; their own licenses apply. Optional NapCat, GitHub CLI, rclone, FFmpeg, Whisper packages and model files are installed separately under the ignored `tools/` directory. They are not included in this source repository.
