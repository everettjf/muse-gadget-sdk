import { getAgentDir, ModelRuntime } from "@earendil-works/pi-coding-agent";

export interface Agent {
  reply(
    text: string,
    delta: (text: string) => void,
    signal: AbortSignal,
  ): Promise<string>;
  dispose(): void;
}

export async function listPiModels(env: NodeJS.ProcessEnv) {
  const dir = env.PI_AGENT_DIR || getAgentDir();
  const runtime = await ModelRuntime.create({
    modelsPath: `${dir}/models.json`,
    authPath: `${dir}/auth.json`,
    allowModelNetwork: false,
  });
  return (await runtime.getAvailable()).map((m) => ({
    provider: m.provider,
    id: m.id,
    name: m.name,
  }));
}
