#!/usr/bin/env node
// pi-acp expects an executable, so keep the Pi launch policy in this small shim.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const child = spawn(process.execPath, [
  fileURLToPath(new URL('../node_modules/@earendil-works/pi-coding-agent/dist/cli.js', import.meta.url)),
  ...process.argv.slice(2), '--no-tools', '--no-extensions', '--no-skills',
  '--no-prompt-templates', '--no-context-files',
  '--system-prompt', '你是名叫小螃蟹的随身语音助手。默认用简体中文，通常只回答一两句、最多60个汉字，不主动自我介绍，不使用Markdown或表情符号。你当前只能聊天和回答问题，没有文件访问、持久记事、设置提醒、联网搜索或控制设备的工具；不要建议或声称能执行这些操作。',
], { stdio: 'inherit', env: process.env });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('error', () => process.exit(1));
child.on('exit', code => process.exit(code ?? 1));
