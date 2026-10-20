<!--
Copyright (c) Meta Platforms, Inc. and affiliates.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->

# Crab Stick 🦀 — your StickS3 voice companion

Hold to talk. Release to listen. An independent M5Stack StickS3 firmware with an animated crab, on-device captions, voice replies and a browser console powered by an ACP agent on your computer.

**No Muse account, SDK token or subscription required.** You choose the model and speech services; cloud model usage follows the provider's pricing.

[Project website](https://xnu.app/crab-stick/) · [中文使用指南](crab/QUICKSTART.zh-CN.md) · [Technical guide](crab/README.md) · [Hardware validation](crab/VALIDATION.md)

## What runs where?

```text
StickS3: hold button → record → Wi-Fi → computer bridge
Computer: speech recognition → Pi / model → speech synthesis
StickS3: animated crab + reply captions + spoken response
Browser: device status, live conversation, errors and settings
```

The verified setup is **StickS3 + macOS + local faster-whisper + Pi / DeepSeek + macOS TTS**. Model credentials stay on the computer. Other speech APIs and local model endpoints can be configured; the bundled macOS speech adapter requires macOS.

## Already configured? Use it in three steps

1. **Start the bridge** from this repository's root:

   ```sh
   cd crab/bridge
   npm start
   ```

   Keep this terminal running and your computer awake. After source changes, run `npm run build` before starting. The device must reach the computer's LAN IP on the same reachable network.

2. **Open [the local console](http://127.0.0.1:8787/)** on the computer. Sign in with `CRAB_TOKEN` from your private `crab/bridge/.env`. The interface defaults to English; use **中文 / English** in the header to switch.

3. **Hold the front button and speak**, then release. Try “你好，你是谁”. You should see the recognized text, reply captions and hear the answer. The browser shows the same conversation and any processing errors.

The public project website explains setup; it is separate from your local console and does not access your device.

## First installation

Prepare a StickS3, a USB data cable, reachable 2.4 GHz Wi-Fi, Node.js **≥22.19**, Python 3 and ESP-IDF **6.0.1**. The verified local speech path uses macOS.

```sh
git clone https://github.com/everettjf/crab-stick.git
cd crab-stick/crab/bridge
npm ci --ignore-scripts
npm run build
npm test
cp -n .env.example .env
```

Then follow these steps in order:

| Step | What to do | Instructions |
|---|---|---|
| 1. Computer configuration | Generate a 32–128 character shared token, set `CRAB_HOST=0.0.0.0` and start with `CRAB_DEMO=true`. | [Bridge setup](crab/README.md#1-start-the-computer-bridge) |
| 2. Model and speech | Run `python3 ../tools/setup_deepseek.py` for DeepSeek, or configure another Pi provider. Install local STT and configure STT/TTS command paths in `.env`. | [Model and speech adapters](crab/README.md#2-configure-pi-and-real-audio) |
| 3. Back up and flash | Save the full 8 MiB original flash and SHA256 before flashing the standalone firmware. Keep the backup private. | [Backup, flash and recovery](crab/README.md#3-build-back-up-and-flash) |
| 4. Device configuration | Over USB, enter Wi-Fi details, `http://COMPUTER_LAN_IP:8787` and the same token. Do not use `localhost` as the device URL. | [USB configuration](crab/README.md#4-configure-over-usb) |
| 5. Test a real turn | Confirm demo captions/tone, set `CRAB_DEMO=false`, restart the bridge and test recognition, captions and audio. | [完整中文步骤](crab/QUICKSTART.zh-CN.md) |

Do not commit API keys, `.env`, flash backups or saved recordings. These local paths are ignored by Git.

## Buttons

| Action | Result |
|---|---|
| Hold front, then release | Record and send, up to 20 seconds |
| Press front during processing/playback | Cancel; wait for cancellation before starting again |
| Short press side | Page through captions and trigger the happy animation |
| Hold side for 3 seconds while idle | Power down; battery-only wake remains to be verified |

## Browser console

Open **http://127.0.0.1:8787/** while the bridge is running:

- See device heartbeats, battery/USB supply, mode and uptime.
- Follow transcripts, streamed replies, processing times and errors.
- Select a configured Pi model and adjust supported recognition/voice settings.
- Switch the UI between English and Chinese without changing recognition language.

Settings apply to the next turn and persist locally. Saving is blocked during active turns. Switching models clears conversation context; speech-only changes preserve it. See [console details](crab/README.md#browser-console).

## If something does not work

| Symptom | First check |
|---|---|
| Connection failed / timed out | Bridge running, computer awake, Wi-Fi reachable, correct computer LAN IP and port in device settings |
| Transcript but no reply | Model credentials and errors in the console / bridge terminal |
| Reply text but no sound | TTS command/API and an installed supported voice |
| USB connection or flashing failure | Correct data cable/port; close other serial monitors |

If the computer's IP changes, update the device URL over USB. Detailed recovery instructions are in the [technical guide](crab/README.md).

## Status and limits

Real hardware has passed Chinese push-to-talk recognition, captions, spoken replies, cancellation, Wi-Fi reconnection and heartbeat checks. The bridge has 19 Node tests plus two Python serial tests. [Validation records](crab/VALIDATION.md) distinguish verified behavior from remaining work.

- The computer must remain available. Transport is trusted-LAN HTTP; do not forward its port to the internet.
- This version chats and answers questions. It has no reminder, persistent note, file or home-control tools.
- Conversations and error history are in memory and clear when the bridge restarts.
- Battery runtime, battery-only wake and long-duration stability still need measurement.

## Repository map

| Path | Purpose |
|---|---|
| [`crab/firmware/`](crab/firmware/) | Standalone ESP-IDF StickS3 firmware |
| [`crab/bridge/`](crab/bridge/) | Pi bridge, speech adapters and authenticated local browser console |
| [`crab/avatar/`](crab/avatar/) | Original animated crab |
| [`crab/tools/`](crab/tools/) | USB setup, backup/restore and hardware checks |
| [`web/`](web/) | Public GitHub Pages project website; deployed from `main` |
| [`esp32/`](esp32/) / [`linux/`](linux/) | Original upstream Muse SDKs |

## Website development

```sh
python3 -m http.server 8080 --directory web
```

Open http://127.0.0.1:8080/. The [Pages workflow](.github/workflows/pages.yml) checks and publishes only `web/` on pushes to `main`. No website build or npm install is needed. See [website maintenance](web/README.md).

## License and upstream

Original Crab code and its avatar are [MIT](crab/LICENSE). Reused upstream files retain their original licenses. The original Muse SDK documentation, community links and third-party attribution are preserved in [README.upstream.md](README.upstream.md). Upstream Muse pairing/token requirements apply to those original applications.

## ACP agent backends

The computer bridge now speaks ACP over stdio. Pi remains the tested default through `pi-acp`; installed adapters also provide Codex and Claude integration. Firmware, speech recognition and speech synthesis are independent of the agent.

In `crab/bridge/.env`, set `CRAB_AGENT=pi`, `codex` or `claude`, then restart the bridge. Run the selected agent's own login/setup first. Provider credentials and subscription eligibility depend on that agent. For other ACP implementations, set a trusted executable and arguments as JSON:

```dotenv
CRAB_ACP_COMMAND=["/absolute/path/to/agent","--acp"]
# Optional model ID from that agent's ACP model configuration:
CRAB_ACP_MODEL=
```

The client negotiates ACP version 1, creates a session per device, streams replies and cancels timed-out requests. An incompatible adapter, missing login or startup failure is reported in the console. Registry entries are not automatically downloaded or executed.

Pi keeps the existing chat-only policy (no tools, extensions or project context). Other agents use their own tool policies: ACP is a communication protocol, not a sandbox. This first integration does not expose interactive tool approval or long-running coding jobs in the browser; permission requests are declined with an explicit error. Use the agent's terminal for those tasks. Voice turns retain the 120-second limit. The console's model list currently remains Pi-specific; select other agents' models with `CRAB_ACP_MODEL`.

Validation covers a real Pi ACP process against a local streaming model server, retained conversation context, disabled Pi tools, permission rejection, cancellation and subprocess crashes. Codex and Claude adapters are installed but are not yet verified against live accounts.
