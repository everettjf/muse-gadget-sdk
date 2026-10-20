# StickS3 螃蟹助手：中文上手指南

把 StickS3 变成一只可以用中文聊天的小螃蟹：按住正面按钮说话，松开后显示字幕并播放回答。设备连接电脑上的桥接服务，无需 Muse 账号、配对或订阅。

已验证组合：**StickS3 + macOS + 本地 faster-whisper + Pi SDK + DeepSeek + macOS 中文语音**。实机的头像、录音、识别、字幕和语音回复已通过用户验收；电池续航、纯电池休眠唤醒和长时间稳定性仍待测试。详见[验收记录](VALIDATION.md)。

[技术说明与协议](README.md) · [仓库首页](../README.md)

## 已经配置好的设备：日常使用

在仓库根目录打开终端：

```sh
cd crab/bridge
npm start
```

保持终端运行、Mac 唤醒，并让设备能访问电脑所在局域网。修改过 TypeScript 源码后，先执行 `npm run build` 再启动。不要同时启动多个桥接服务，也不要在对话处理中重启服务。

| 操作 | 效果 |
|---|---|
| 按住正面按钮，松开 | 录音并发送，最长 20 秒 |
| 处理或播放时按正面按钮 | 取消；取消完成后可再次录音 |
| 短按侧面按钮 | 翻字幕页，让螃蟹开心 |
| 待机时长按侧面按钮 3 秒 | 关机；按钮唤醒行为仍需纯电池实测 |

首版只支持聊天和问答。对话保存在电脑内存里，重启服务会清空；说“明天下午三点取快递”不会创建提醒或持久便签。

## 浏览器控制台

界面默认英文，右上角 **中文 / English** 可随时切换并记住选择。切换只影响界面文案，不修改对话内容、识别语言或未保存设置。

电脑服务运行后，打开 **http://127.0.0.1:8787/**，输入本机 `crab/bridge/.env` 中的 `CRAB_TOKEN`。局域网其他设备可用电脑 IP 加同一端口访问。

控制台可查看设备心跳、电量、USB 供电和状态，实时显示识别文字与模型回复，筛选错误日志，并切换 Pi 模型或调整语音设置。新固件每 10 秒上报，超过 35 秒未收到心跳会标记过期；旧固件只能显示最近请求，无法确认持续在线。

模型切换会清空所有设备的聊天上下文，语音变更保留上下文。设备处理期间不能保存设置；保存后下一轮生效。首次切换 Whisper 模型可能需要下载，本地 Voice name 支持下拉选择，按语言分组，中文优先；列表由系统提供，安装新声音后重新连接控制台即可刷新。语音 API 仍使用服务商支持的声音名。

设置保存在被 Git 忽略的 `bridge/data/console-settings.json`，重启仍有效；恢复 `.env` 默认值时，先停服务再移走该文件。对话和日志只保留在服务内存里。令牌只留在当前页面内存，刷新后需重新输入。

## 首次安装：准备环境

需要 StickS3、USB 数据线、可互通的 2.4 GHz Wi-Fi，以及：

- Node.js ≥ 22.19、Python 3、ESP-IDF 6.0.1。
- 当前本地语音方案使用 macOS；其他系统可接入自定义 STT/TTS 命令或兼容 API。
- 模型服务的 API key，或自行配置的本地模型。云端模型仍按服务商规则收费。

以下步骤从仓库根目录开始。端口和 ESP-IDF 路径均需换成你自己的实际值。密钥、共享 token 和 Wi-Fi 密码只保存在本机。

### 1. 安装电脑端依赖

```sh
cd crab/bridge
npm ci --ignore-scripts
npm run build
npm test
cp -n .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

把生成的随机值填入 `.env` 的 `CRAB_TOKEN`，再设置：

```dotenv
CRAB_HOST=0.0.0.0
CRAB_DEMO=true
```

`0.0.0.0` 让设备能从局域网连接电脑；它不是稍后填写给设备的服务地址。共享 token 应为 32–128 个可打印 ASCII 字符。设备端必须填写相同值。

### 2. 启动 demo，备份和烧录

在 `crab/bridge` 运行：

```sh
npm start
```

另开终端，从仓库根目录运行：

```sh
. /path/to/esp-idf-v6/export.sh
cd crab/firmware
python ../tools/device.py status --port /dev/cu.usbmodemXXXX
python ../tools/device.py backup --port /dev/cu.usbmodemXXXX
idf.py build
```

备份会生成 `crab/backups/sticks3-TIMESTAMP.bin` 和对应 SHA256 文件。确认备份成功，再用实际文件名执行：

```sh
python ../tools/device.py flash --port /dev/cu.usbmodemXXXX --file ../backups/sticks3-TIMESTAMP.bin
python ../tools/device.py configure --port /dev/cu.usbmodemXXXX
```

配置工具会依次询问 SSID、Wi-Fi 密码、电脑服务地址和共享 token。地址示例为 `http://192.168.1.10:8787`，应填写 Mac 当前的局域网 IP，不要填写 `localhost` 或 `0.0.0.0`。密码和 token 输入不回显，保存后设备重启。

此时按住正面按钮说话、松开，应收到固定中文字幕和半秒测试音。demo 只验证传输与播放，不做真实识别或调用模型。

完整备份含原设备凭据，应保留在本机。首次安装会改变分区布局，不能假定原配对和 Wi-Fi 数据能直接沿用。启动失败或需要手动恢复时，查看[烧录与恢复说明](README.md#3-build-back-up-and-flash)。同一时间只开一个串口客户端，刷写前关闭 monitor。

### 3. 配置 DeepSeek / Pi

在 `crab/bridge` 中运行：

```sh
python3 ../tools/setup_deepseek.py
```

按隐藏提示输入 API key。工具将凭据写入被 Git 忽略的本地配置，并选择 DeepSeek 模型。

其他服务可运行 `./node_modules/.bin/pi`，使用 `/login` 与 `/model`。桥接服务默认读取 `~/.pi/agent`，或 `.env` 中指定的 `PI_AGENT_DIR`；模型由 `PI_PROVIDER` 与 `PI_MODEL` 选择。本地模型配置方式见 [Pi models.json 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md)。

### 4. 配置本地中文语音

另开终端，从仓库根目录运行：

```sh
cd crab
python3 -m venv tools/.venv
tools/.venv/bin/pip install -r tools/requirements-audio.txt
```

在 `crab/bridge/.env` 中添加命令，替换 `/absolute/repo` 为仓库的绝对路径：

```dotenv
STT_COMMAND=["/absolute/repo/crab/tools/.venv/bin/python","/absolute/repo/crab/tools/local_audio.py","stt","{input}","--model","small","--language","zh"]
TTS_COMMAND=["/usr/bin/python3","/absolute/repo/crab/tools/local_audio.py","tts","{text}","{output}"]
```

首次识别会下载 small 模型，建议先用真实 WAV 预热，再测试设备。当前方案每轮重新加载模型，会带来额外延迟。TTS 使用系统 `Tingting` 中文声音，可用 `say -v '?'` 检查是否已安装。也可以按[技术说明](README.md#cloud-or-local-api-endpoints)接入语音 API。

### 5. 开启真实对话

把 `.env` 改为 `CRAB_DEMO=false`，停止旧服务，再运行 `npm start`。

按住正面按钮，靠近麦克风说“你好，你是谁”，松开后检查识别文字、回复字幕和声音。再测一次“明天下午三点去取快递”，比较识别结果。已连接的测试设备在这两轮实测中都正常显示并播放了回复。

## 常见问题

| 现象 | 处理 |
|---|---|
| 连接失败或超时 | 确认电脑服务正在运行、Mac 没休眠、Wi-Fi 可互通，设备 URL 的 IP 和端口正确。电脑换 IP 后需通过 USB 重新配置。 |
| 识别正常但没有回复 | 查看电脑服务终端，确认 Pi 模型凭据有效，且未在对话中途重启服务。 |
| 有回复字幕但没声音 | 检查 TTS 命令、系统中文声音或语音 API；合成失败时会保留文字回复。 |
| 中文识别不准 | 靠近麦克风、降低背景噪声，并用自己的声音评估 STT 模型。 |
| USB 配置或刷写失败 | 检查数据线和实际端口，关闭其他串口监控程序。 |

当前使用局域网 HTTP，共享 token 用于认证，不提供传输加密；不要将服务端口转发到公网。API key 留在电脑，Wi-Fi 和设备 token 保存在设备 NVS。录音默认不落盘，调试时开启保存则需自行清理。

## 恢复原 Muse 固件

在 `crab/firmware`，使用完整备份及其对应 SHA256 文件：

```sh
python ../tools/device.py restore --port /dev/cu.usbmodemXXXX --file ../backups/sticks3-TIMESTAMP.bin
```

设备无法正常启动时，按[技术说明](README.md#3-build-back-up-and-flash)中的 ROM 模式恢复流程操作。

## 切换 ACP agent

电脑桥接端统一使用 ACP。默认 `pi-acp` 转接 Pi，现有语音、螃蟹动画和设备协议保持兼容。

编辑私有的 `crab/bridge/.env`，设置 `CRAB_AGENT=pi`、`codex` 或 `claude`，完成对应 agent 自己的登录后，重启 `npm start`。其他 ACP 程序可配置 `CRAB_ACP_COMMAND=["/绝对路径/agent","--acp"]`；这是 JSON 参数数组，不通过 shell 执行。可用 `CRAB_ACP_MODEL` 指定 agent 公布的完整模型 ID。

当前已验证 Pi 的真实 ACP 语音链路。Codex、Claude 适配器已安装，尚未使用真实账号验证。Pi 仍禁用工具；其他 agent 的工具策略由自身控制，ACP 本身不是沙箱。设备语音请求仍限时 120 秒，交互式工具审批暂不支持，收到权限请求会拒绝并显示错误。浏览器模型列表目前仅供 Pi 使用，其他后端请通过 `CRAB_ACP_MODEL` 配置。暂不自动安装或执行网上注册表中的程序。
