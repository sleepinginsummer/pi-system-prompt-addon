# pi-system-prompt-addon

在 Pi 的系统提示词末尾追加一段补充提示词，每个会话独立开关，默认关闭。

## 安装

```bash
pi install git:github.com/sleepinginsummer/pi-system-prompt-addon
```

## 行为

- 新会话开始时（首条消息）复制一份默认内容，之后这个会话只用自己的副本，改默认内容或其他会话都影响不到它。
- 每次调用模型前重新读取副本，运行途中的开关和编辑从下一次模型调用起生效。追加内容只进请求，不写入会话记录。
- 只加载到主会话，不影响子代理。

## 数据

都在 Pi 的 agent 目录下：

| 文件 | 内容 |
| --- | --- |
| `pi-web-system-prompt-addon.json` | 新会话的默认内容 `{ "version": 1, "text": "..." }` |
| `pi-web-system-prompt-addon-sessions/<会话 id>.json` | 会话副本 `{ "version": 1, "enabled": false, "text": "..." }` |

开关和内容的编辑界面在 [pi-web](https://github.com/sleepinginsummer/pi-web) 顶栏的“补充提示词”。扩展本身没有命令；不用 pi-web 时可以直接改这些文件。
