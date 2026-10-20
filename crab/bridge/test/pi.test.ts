import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAcpAgent as createPiAgent } from "../src/acp.js";

test("real Pi ACP adapter streams a reply, retains context, and has no enabled tools", async () => {
  const requests: any[] = [];
  const api = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push(body);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(
      "data: " +
        JSON.stringify({
          id: "test",
          object: "chat.completion.chunk",
          created: 0,
          model: "crab-test",
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "你好，小螃蟹！" },
              finish_reason: null,
            },
          ],
        }) +
        "\n\n",
    );
    res.write(
      "data: " +
        JSON.stringify({
          id: "test",
          object: "chat.completion.chunk",
          created: 0,
          model: "crab-test",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        }) +
        "\n\n",
    );
    res.end("data: [DONE]\n\n");
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  const port = (api.address() as { port: number }).port;
  const dir = await mkdtemp(join(tmpdir(), "crab-pi-"));
  await mkdir(join(dir, "work"));
  await writeFile(
    join(dir, "models.json"),
    JSON.stringify({
      providers: {
        "crab-local": {
          baseUrl: `http://127.0.0.1:${port}/v1`,
          api: "openai-completions",
          apiKey: "test-only",
          models: [
            {
              id: "crab-test",
              name: "Crab test",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 8192,
              maxTokens: 512,
            },
          ],
        },
      },
    }),
  );
  let agent;
  try {
    agent = await createPiAgent(join(dir, "work"), {
      PI_AGENT_DIR: dir,
      PI_PROVIDER: "crab-local",
      PI_MODEL: "crab-test",
    });
    let streamed = "";
    assert.equal(
      await agent.reply(
        "你好",
        (text) => (streamed += text),
        new AbortController().signal,
      ),
      "你好，小螃蟹！",
    );
    assert.equal(streamed, "你好，小螃蟹！");
    await agent.reply(
      "我刚才说了什么？",
      () => {},
      new AbortController().signal,
    );
    assert.equal(requests.length, 2);
    assert.ok(!requests[0].tools || requests[0].tools.length === 0);
    assert.ok(
      requests[1].messages.some(
        (x: any) => x.role === "assistant" && x.content === "你好，小螃蟹！",
      ),
    );
  } finally {
    agent?.dispose();
    api.close();
    api.closeAllConnections();
    await rm(dir, { recursive: true, force: true });
  }
});
