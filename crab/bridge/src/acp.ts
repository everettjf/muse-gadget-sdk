import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { delimiter, resolve } from "node:path";
import * as acp from "@agentclientprotocol/sdk";
import type { Agent } from "./pi.js";

/** Launch only trusted local configuration; never execute registry entries automatically. */
export function agentCommand(env: NodeJS.ProcessEnv): string[] {
  if (env.CRAB_ACP_COMMAND) {
    const command: unknown = JSON.parse(env.CRAB_ACP_COMMAND);
    if (
      !Array.isArray(command) ||
      !command.length ||
      command.some((x) => typeof x !== "string" || !x)
    )
      throw new Error("CRAB_ACP_COMMAND must be a non-empty JSON string array");
    return command;
  }
  const commands: Record<string, string> = {
    pi: "pi-acp",
    codex: "codex-acp",
    claude: "claude-agent-acp",
  };
  const name = commands[env.CRAB_AGENT || "pi"];
  if (!name)
    throw new Error(
      "Unknown CRAB_AGENT; use pi, codex, claude or CRAB_ACP_COMMAND",
    );
  return [resolve("node_modules/.bin", name)];
}

export async function createAcpAgent(
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<Agent> {
  const [command, ...args] = agentCommand(env);
  const child = spawn(command, args, {
    cwd,
    stdio: "pipe",
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      ...env,
      PATH: `${resolve("node_modules/.bin")}${delimiter}${process.env.PATH || ""}`,
      PI_CODING_AGENT_DIR: env.PI_AGENT_DIR || env.PI_CODING_AGENT_DIR,
      PI_ACP_PI_COMMAND: fileURLToPath(
        new URL("../src/pi-launch.mjs", import.meta.url),
      ),
    },
  });
  let failure: Error | undefined;
  let delta: ((text: string) => void) | undefined;
  let permissionDenied = false;
  // Do not forward subprocess stderr: adapters can include credentials in diagnostics.
  child.stderr.resume();
  child.on("error", (e) => {
    failure = e;
  });
  const connection = new acp.ClientSideConnection(
    () => ({
      async sessionUpdate({ update }) {
        if (
          update.sessionUpdate === "agent_message_chunk" &&
          update.content.type === "text"
        )
          delta?.(update.content.text);
      },
      async requestPermission() {
        permissionDenied = true;
        return { outcome: { outcome: "cancelled" as const } };
      },
    }),
    acp.ndJsonStream(
      Writable.toWeb(child.stdin),
      Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
    ),
  );
  const dispose = () => {
    if (child.exitCode !== null) return;
    try {
      if (process.platform === "win32") child.kill();
      else if (child.pid) process.kill(-child.pid, "SIGTERM");
    } catch {
      /* already exited */
    }
    const timer = setTimeout(() => {
      try {
        if (process.platform === "win32") child.kill("SIGKILL");
        else if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        /* already exited */
      }
    }, 2000);
    timer.unref();
    child.once("exit", () => clearTimeout(timer));
  };
  const startup = AbortSignal.timeout(30_000);
  const bounded = <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> =>
    new Promise((yes, no) => {
      const abort = () => {
        dispose();
        no(signal.reason);
      };
      if (signal.aborted) return abort();
      signal.addEventListener("abort", abort, { once: true });
      promise
        .then(yes, (e) => no(failure || e))
        .finally(() => signal.removeEventListener("abort", abort));
    });
  try {
    const init = await bounded(
      connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: { name: "crab-stick", version: "0.1.0" },
      }),
      startup,
    );
    if (init.protocolVersion !== acp.PROTOCOL_VERSION)
      throw new Error("Incompatible ACP protocol version");
    const session = await bounded(
      connection.newSession({ cwd, mcpServers: [] }),
      startup,
    );
    const model =
      env.CRAB_ACP_MODEL ||
      ((env.CRAB_AGENT || "pi") === "pi" && env.PI_PROVIDER && env.PI_MODEL
        ? `${env.PI_PROVIDER}/${env.PI_MODEL}`
        : "");
    if (model) {
      const option = session.configOptions?.find(
        (option) => option.category === "model",
      );
      if (!option)
        throw new Error(
          "Agent does not advertise a model configuration option",
        );
      await bounded(
        connection.setSessionConfigOption({
          sessionId: session.sessionId,
          configId: option.id,
          value: model,
        }),
        startup,
      );
    }
    return {
      dispose,
      async reply(text, onDelta, signal) {
        signal.throwIfAborted();
        let result = "";
        permissionDenied = false;
        delta = (chunk) => {
          result += chunk;
          onDelta(chunk);
        };
        const cancel = () => {
          void connection
            .cancel({ sessionId: session.sessionId })
            .catch(() => {});
        };
        signal.addEventListener("abort", cancel, { once: true });
        try {
          const response = await bounded(
            connection.prompt({
              sessionId: session.sessionId,
              prompt: [{ type: "text", text }],
            }),
            signal,
          );
          signal.throwIfAborted();
          if (permissionDenied)
            throw new Error(
              "Agent requested tool permission; voice bridge cannot approve tools yet. Use the agent terminal for this operation.",
            );
          if (response.stopReason !== "end_turn")
            throw new Error(`Agent stopped: ${response.stopReason}`);
          if (!result.trim()) throw new Error("ACP agent returned no reply");
          return result;
        } finally {
          delta = undefined;
          signal.removeEventListener("abort", cancel);
        }
      },
    };
  } catch (e) {
    dispose();
    throw e;
  }
}
