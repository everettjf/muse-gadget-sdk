import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { AudioServices } from "./audio.js";
import { listPiModels } from "./pi.js";
import { createAcpAgent } from "./acp.js";
import { createBridge } from "./server.js";
import { SettingsStore, defaultSettings, audioEnvironment } from "./control.js";

import { listMacVoices } from "./voices.js";

const env = process.env;
const dataDir = resolve("data");
await mkdir(resolve(dataDir, "workspace"), { recursive: true });
const demo = env.CRAB_DEMO === "true";
if (!demo && !env.STT_URL && !env.STT_COMMAND)
  throw new Error(
    "Configure STT_URL/STT_COMMAND or set CRAB_DEMO=true for transport testing",
  );
const settings = await SettingsStore.load(
  resolve(dataDir, "console-settings.json"),
  defaultSettings(env),
);
const server = createBridge(
  {
    token: env.CRAB_TOKEN || "",
    dataDir,
    saveRecordings: env.CRAB_SAVE_RECORDINGS === "true",
    demo,
    settings,
    secrets: Object.entries(env)
      .filter(([key]) => /(?:KEY|TOKEN|SECRET|PASSWORD)$/.test(key))
      .map(([, value]) => value || ""),
    audioInfo: {
      stt: env.STT_COMMAND ? "command" : "api",
      tts: env.TTS_COMMAND ? "command" : env.TTS_URL ? "api" : "none",
      bundledStt: /local_audio\.py/.test(env.STT_COMMAND || ""),
      bundledTts: /local_audio\.py/.test(env.TTS_COMMAND || ""),
    },
  },
  {
    audio: new AudioServices(env),
    audioFor: (value) => new AudioServices(audioEnvironment(env, value)),
    agent: (_id, value) =>
      createAcpAgent(resolve(dataDir, "workspace"), {
        ...env,
        PI_PROVIDER: value.provider,
        PI_MODEL: value.model,
      }),
    models: () =>
      (env.CRAB_AGENT && env.CRAB_AGENT !== "pi") || env.CRAB_ACP_COMMAND
        ? Promise.resolve([])
        : listPiModels(env),
    voices: /local_audio\.py/.test(env.TTS_COMMAND || "")
      ? listMacVoices
      : undefined,
  },
);
const port = Number(env.CRAB_PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid CRAB_PORT");
server.listen(port, env.CRAB_HOST || "127.0.0.1", () =>
  console.log(
    `Crab bridge listening on ${env.CRAB_HOST || "127.0.0.1"}:${port}${demo ? " (demo)" : ""}`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    server.close();
    server.closeAllConnections();
  });
