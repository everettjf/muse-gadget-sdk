import {
  createServer,
  type ServerResponse,
  type IncomingMessage,
} from "node:http";
import { timingSafeEqual } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AudioServices, MAX_WAV_BYTES, validateWav } from "./audio.js";
import type { Agent } from "./pi.js";
import { resolveVoiceName, type VoiceChoice } from "./voices.js";
import {
  SettingsStore,
  Monitor,
  defaultSettings,
  type RuntimeSettings,
  type ModelChoice,
} from "./control.js";
import { consoleAsset, consoleRoutes, jsonBody, json } from "./console.js";

export type BridgeConfig = {
  token: string;
  dataDir: string;
  saveRecordings: boolean;
  demo: boolean;
  settings?: SettingsStore;
  secrets?: string[];
  audioInfo?: object;
};
export type Services = {
  audio: Pick<AudioServices, "transcribe" | "speak">;
  agent: (id: string, settings: RuntimeSettings) => Promise<Agent>;
  audioFor?: (settings: RuntimeSettings) => Services["audio"];
  models?: () => Promise<ModelChoice[]>;
  voices?: () => Promise<VoiceChoice[]>;
};
function displayError(error: unknown): string {
  const message = error instanceof Error ? error.message : "对话失败，请重试";
  if (/No speech recognized/i.test(message))
    return "没有听清，请靠近麦克风再说一次";
  if (/\b(401|403)\b/.test(message))
    return "模型或语音服务认证失败，请检查电脑端配置";
  return message.replace(/sk-[a-zA-Z0-9_-]+/g, "[redacted]").slice(0, 500);
}

export function createBridge(config: BridgeConfig, services: Services) {
  if (!/^[\x21-\x7e]{32,128}$/.test(config.token))
    throw new Error(
      "CRAB_TOKEN must contain 32–128 printable ASCII characters",
    );
  const active = new Map<string, AbortController>();
  const agents = new Map<string, Promise<Agent>>();
  const lastUsed = new Map<string, number>();
  const store = config.settings || new SettingsStore(defaultSettings({}));
  const monitor = new Monitor([config.token, ...(config.secrets || [])]);
  let updating = false;
  const control = consoleRoutes(
    store,
    monitor,
    services.models || (async () => []),
    async (value) => {
      if (active.size || updating)
        throw new Error("设备正在处理中，请稍后保存设置");
      updating = true;
      try {
        const next = value as RuntimeSettings;
        if (next.provider || next.model) {
          const choices = await services.models?.();
          if (
            !choices?.some(
              (m) => m.provider === next.provider && m.id === next.model,
            )
          )
            throw new Error(
              "模型不可用，请先在电脑端配置 Pi 凭据与 models.json",
            );
        }
        if (services.voices && next.ttsEnabled) {
          const voices = await services.voices();
          const voice = resolveVoiceName(voices, next.voice);
          if (!voice) throw new Error("所选声音不可用，请重新选择系统声音");
          next.voice = voice;
        }
        const switched =
          next.provider !== store.current.provider ||
          next.model !== store.current.model;
        await store.save(next);
        if (switched) {
          const previous = [...agents.values()];
          agents.clear();
          lastUsed.clear();
          await Promise.all(
            previous.map((a) => a.then((x) => x.dispose()).catch(() => {})),
          );
        }
        monitor.changed();
      } finally {
        updating = false;
      }
    },
    { demo: config.demo, audio: config.audioInfo || {} },
    services.voices || (async () => []),
  );
  function auth(req: IncomingMessage) {
    const got = Buffer.from(req.headers.authorization || "");
    const want = Buffer.from(`Bearer ${config.token}`);
    return got.length === want.length && timingSafeEqual(got, want);
  }
  async function event(res: ServerResponse, value: object) {
    if (res.destroyed) throw new Error("Device disconnected");
    if (!res.write(JSON.stringify(value) + "\n")) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          res.off("drain", drain);
          res.off("close", close);
          res.off("error", error);
        };
        const drain = () => {
          cleanup();
          resolve();
        };
        const close = () => {
          cleanup();
          reject(new Error("Device disconnected"));
        };
        const error = (e: Error) => {
          cleanup();
          reject(e);
        };
        res.once("drain", drain);
        res.once("close", close);
        res.once("error", error);
      });
    }
  }
  const server = createServer(async (req, res) => {
    if (await consoleAsset(req, res)) return;
    if (
      req.headers.origin &&
      req.headers.origin !== `http://${req.headers.host}`
    ) {
      res.writeHead(403);
      res.end("Origin rejected");
      return;
    }
    if (!auth(req)) {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }
    if (await control.handle(req, res)) return;
    if (req.method === "GET" && req.url === "/health") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, demo: config.demo }));
      return;
    }
    const id = req.headers["x-device-id"];
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
      res.writeHead(400);
      res.end("Invalid device ID");
      return;
    }
    if (req.method === "POST" && req.url === "/v1/status") {
      try {
        const body = (await jsonBody(req, 2048)) as Record<string, unknown>;
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw new Error("Invalid status");
        const fields: Record<string, unknown> = { heartbeatAt: Date.now() };
        for (const key of ["battery", "mode", "uptime_ms", "free_internal"]) {
          const v = body[key];
          if (
            typeof v !== "number" ||
            !Number.isFinite(v) ||
            v < 0 ||
            (key === "battery" && v > 100) ||
            (key === "mode" && v > 7)
          )
            throw new Error("Invalid status");
          fields[key] = v;
        }
        if (typeof body.usb !== "boolean") throw new Error("Invalid status");
        fields.usb = body.usb;
        monitor.touch(id, fields);
        res.writeHead(204);
        res.end();
      } catch {
        json(res, { error: "Invalid status" }, 400);
      }
      return;
    }
    if (req.method === "POST" && req.url === "/v1/cancel") {
      active.get(id)?.abort();
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === "POST" && req.url === "/v1/reset") {
      if (active.has(id)) {
        res.writeHead(409);
        res.end("Device busy");
        return;
      }
      const old = agents.get(id);
      agents.delete(id);
      lastUsed.delete(id);
      if (old) await old.then((a) => a.dispose()).catch(() => {});
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== "POST" || req.url !== "/v1/turn") {
      res.writeHead(404);
      res.end();
      return;
    }
    if (active.has(id) || updating) {
      res.writeHead(409);
      res.end("Device busy");
      return;
    }
    if (req.headers["content-type"] !== "audio/wav") {
      res.writeHead(415);
      res.end("Expected audio/wav");
      return;
    }
    if (active.size >= 4) {
      res.writeHead(503);
      res.end("Bridge busy");
      return;
    }
    const controller = new AbortController();
    active.set(id, controller);
    const settings = { ...store.current };
    let audio = services.audio;
    const turn = monitor.start(id);
    const observed = (value: { type: string; text?: string }) => {
      if (value.type === "accepted") turn.state = "transcribing";
      if (value.type === "transcript") {
        turn.transcript = monitor.clean(value.text || "");
        turn.state = "thinking";
      }
      if (value.type === "text_delta")
        turn.reply = monitor.clean(turn.reply + (value.text || ""));
      if (value.type === "reply") {
        turn.reply = monitor.clean(value.text || "");
        turn.state = "synthesizing";
      }
      if (value.type === "warning")
        monitor.log("warning", id, value.text || "语音合成失败");
      if (value.type === "done") turn.state = "done";
      monitor.changed();
    };
    const send = async (value: {
      type: string;
      text?: string;
      rate?: number;
      pcm?: string;
    }) => {
      if (value.type !== "audio") observed(value);
      else if (turn.state !== "sending") {
        turn.state = "sending";
        monitor.changed();
      }
      await event(res, value);
    };
    const timeout = setTimeout(
      () => controller.abort(new Error("Turn timed out")),
      120000,
    );
    res.on("close", () => {
      if (!res.writableFinished) controller.abort();
    });
    const startedAt = performance.now();
    const timing: Record<string, number> = {};
    try {
      audio = services.audioFor?.(settings) || services.audio;
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of req) {
        controller.signal.throwIfAborted();
        total += chunk.length;
        if (total > MAX_WAV_BYTES) {
          turn.state = "error";
          turn.error = "录音超过 20 秒限制";
          monitor.log("error", id, turn.error);
          res.writeHead(413);
          res.end("Recording exceeds 20 seconds");
          return;
        }
        chunks.push(chunk);
      }
      const wav = Buffer.concat(chunks);
      validateWav(wav);
      if (config.saveRecordings) {
        await mkdir(join(config.dataDir, "recordings"), { recursive: true });
        await writeFile(
          join(config.dataDir, "recordings", `${id}-${Date.now()}.wav`),
          wav,
          { mode: 0o600 },
        );
      }
      res.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
      });
      await send({ type: "accepted" });
      const transcript = config.demo
        ? "你好，小螃蟹。"
        : await audio.transcribe(wav, controller.signal);
      if (!transcript.trim()) throw new Error("No speech recognized");
      timing.stt_ms = Math.round(performance.now() - startedAt);
      await send({ type: "transcript", text: transcript });
      let answer: string;
      if (config.demo) {
        answer = "我是小螃蟹！设备连接、字幕和音频链路正常。";
        await send({ type: "text_delta", text: answer });
      } else {
        // Bound idle sessions to avoid unbounded memory use from device IDs.
        for (const [key, used] of lastUsed)
          if (!active.has(key) && Date.now() - used > 30 * 60 * 1000) {
            const old = agents.get(key);
            agents.delete(key);
            lastUsed.delete(key);
            if (old) (await old).dispose();
          }
        if (!agents.has(id)) {
          if (agents.size >= 16)
            throw new Error("Too many sessions; reset an idle device");
          agents.set(id, services.agent(id, settings));
        }
        const promise = agents.get(id)!;
        let agent: Agent;
        try {
          agent = await promise;
        } catch (e) {
          agents.delete(id);
          throw e;
        }
        let streamedChars = 0;
        answer = await agent.reply(
          transcript,
          (text) => {
            const remaining = Math.max(0, 1000 - streamedChars);
            text = [...text].slice(0, remaining).join("");
            streamedChars += [...text].length;
            if (!text) return;
            // Pi callback is synchronous. Small text deltas are bounded by the 4 KiB answer budget.
            if (res.writableLength > 65536)
              controller.abort(new Error("Device is not consuming replies"));
            if (!controller.signal.aborted && !res.destroyed) {
              observed({ type: "text_delta", text });
              res.write(JSON.stringify({ type: "text_delta", text }) + "\n");
            }
          },
          controller.signal,
        );
        lastUsed.set(id, Date.now());
      }
      timing.reply_ms = Math.round(performance.now() - startedAt);
      answer = [...answer].slice(0, 1000).join("");
      await send({ type: "reply", text: answer });
      let pcm: Buffer | null;
      if (config.demo) {
        pcm = Buffer.alloc(16000);
        for (let i = 0; i < 8000; i++)
          pcm.writeInt16LE(
            Math.round(Math.sin((i * 2 * Math.PI * 440) / 16000) * 1200),
            i * 2,
          );
      } else {
        try {
          pcm = settings.ttsEnabled
            ? await audio.speak(answer, controller.signal)
            : null;
        } catch (e) {
          controller.signal.throwIfAborted();
          pcm = null;
          await send({
            type: "warning",
            text: "语音合成失败，仅显示文字：" + monitor.clean(displayError(e)),
          });
        }
      }
      timing.tts_ms = Math.round(performance.now() - startedAt);
      if (pcm)
        for (let at = 0; at < pcm.length; at += 6400) {
          controller.signal.throwIfAborted();
          await send({
            type: "audio",
            rate: 16000,
            pcm: pcm.subarray(at, at + 6400).toString("base64"),
          });
        }
      timing.total_ms = Math.round(performance.now() - startedAt);
      turn.timing = { ...timing };
      console.info(
        JSON.stringify({
          device: id,
          ...timing,
          audio_ms: pcm ? Math.round(pcm.length / 32) : 0,
        }),
      );
      await send({ type: "done" });
      res.end();
    } catch (e) {
      // A cancelled/crashed ACP process cannot serve another turn. Recreate lazily.
      const failed = agents.get(id);
      agents.delete(id);
      if (failed) void failed.then((agent) => agent.dispose()).catch(() => {});
      turn.state = controller.signal.aborted ? "cancelled" : "error";
      turn.error = controller.signal.aborted
        ? "已取消或处理超时，请重试"
        : monitor.clean(displayError(e));
      monitor.log(
        controller.signal.aborted ? "warning" : "error",
        id,
        turn.error,
      );
      if (!res.headersSent) {
        res.writeHead(400);
        res.end(turn.error);
      } else if (!res.destroyed) {
        res.write(
          JSON.stringify({
            type: "error",
            text: controller.signal.aborted
              ? "已取消或处理超时，请重试"
              : turn.error,
          }) + "\n",
        );
        res.end();
      }
    } finally {
      clearTimeout(timeout);
      active.delete(id);
      if (turn.state === "upload") turn.state = "error";
      monitor.touch(id, { processing: false });
    }
  });
  server.headersTimeout = 15000;
  server.requestTimeout = 30000;
  server.on("close", () => {
    control.close();
    for (const c of active.values()) c.abort();
    for (const a of agents.values())
      void a.then((x) => x.dispose()).catch(() => {});
  });
  // SSE connections need closing before server.close() can finish.
  const close = server.close.bind(server);
  server.close = ((callback?: (err?: Error) => void) => {
    control.close();
    return close(callback);
  }) as typeof server.close;
  return server;
}
