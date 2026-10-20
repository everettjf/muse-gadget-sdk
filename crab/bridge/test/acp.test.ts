import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentCommand, createAcpAgent } from "../src/acp.js";

test("ACP launch configuration rejects shell strings and unknown agents", () => {
  assert.throws(() => agentCommand({ CRAB_ACP_COMMAND: '"echo unsafe"' }));
  assert.throws(() => agentCommand({ CRAB_AGENT: "unknown" }));
  assert.deepEqual(
    agentCommand({ CRAB_ACP_COMMAND: '["/path with spaces/agent","--acp"]' }),
    ["/path with spaces/agent", "--acp"],
  );
});

test("generic ACP client reports denied permission, cancels stalled prompts and handles crashes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "crab-acp-"));
  const script = join(dir, "agent.mjs");
  await writeFile(
    script,
    `
import readline from 'node:readline';
const send = x => process.stdout.write(JSON.stringify(x)+'\\n');
for await (const line of readline.createInterface({input:process.stdin})) {
 const m=JSON.parse(line);
 if (m.method==='initialize') send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1,agentCapabilities:{}}});
 if (m.method==='session/new') send({jsonrpc:'2.0',id:m.id,result:{sessionId:'test'}});
 if (m.method==='session/prompt') {
   const text=m.params.prompt[0].text;
   if(text==='crash') process.exit(1);
   if(text==='permission') { globalThis.promptId=m.id; send({jsonrpc:'2.0',id:900,method:'session/request_permission',params:{sessionId:'test',toolCall:{toolCallId:'t',title:'Write file',status:'pending'},options:[{optionId:'yes',name:'Allow',kind:'allow_once'}]}}); }
 }
 if(m.id===900 && m.result) send({jsonrpc:'2.0',id:globalThis.promptId,result:{stopReason:'end_turn'}});
}
`,
  );
  const env = { CRAB_ACP_COMMAND: JSON.stringify([process.execPath, script]) };
  try {
    let agent = await createAcpAgent(dir, env);
    try {
      await assert.rejects(
        agent.reply("permission", () => {}, AbortSignal.timeout(2000)),
        /permission/,
      );
    } finally {
      agent.dispose();
    }
    agent = await createAcpAgent(dir, env);
    try {
      await assert.rejects(
        agent.reply("wait", () => {}, AbortSignal.timeout(100)),
        /abort|timeout/i,
      );
    } finally {
      agent.dispose();
    }
    agent = await createAcpAgent(dir, env);
    try {
      await assert.rejects(
        agent.reply("crash", () => {}, AbortSignal.timeout(2000)),
      );
    } finally {
      agent.dispose();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
