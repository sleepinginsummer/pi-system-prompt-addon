import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getCurrentSystemMessage, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * 磁盘格式与 pi-web 的 lib/system-prompt-addon.ts 共用，改格式要两边一起改。
 * 全局文件只存新会话的默认内容；会话副本在会话开始时创建，此后只读写副本。
 */
type SessionAddon = { enabled: boolean; text: string };

function readJson(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null;
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function sessionAddonPath(agentDir: string, sessionId: string): string {
  // 会话 id 要拼进路径，挡住分隔符和 “..”。
  if (!/^[\w-]+$/.test(sessionId)) throw new RangeError("Invalid sessionId");
  return join(agentDir, "pi-web-system-prompt-addon-sessions", `${sessionId}.json`);
}

export function ensureSessionAddon(agentDir: string, sessionId: string): SessionAddon {
  const path = sessionAddonPath(agentDir, sessionId);
  const stored = readJson(path);
  if (stored && typeof stored.text === "string") return { enabled: stored.enabled === true, text: stored.text };

  const defaultText = readJson(join(agentDir, "pi-web-system-prompt-addon.json"))?.text;
  const created = { enabled: false, text: typeof defaultText === "string" ? defaultText : "" };
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify({ version: 1, ...created }, null, 2), { mode: 0o600 });
  renameSync(temp, path);
  return created;
}

export function appendAddon(systemPrompt: string, addon: SessionAddon): string | undefined {
  const text = addon.text.trim();
  if (!addon.enabled || !text) return undefined;
  const base = systemPrompt.trimEnd();
  return base ? `${base}\n\n${text}` : text;
}

export function createExtension(agentDir: string) {
  return (pi: ExtensionAPI) => {
    // SDK 的强制提示词投影包在 context 事件外层，本轮有扩展返回过 systemPrompt 时会盖掉
    // 下面的结果，所以这种情况在这里接到强制文本后面。
    pi.on("before_agent_start", (event, ctx) => {
      const addon = ensureSessionAddon(agentDir, ctx.sessionManager.getSessionId());
      if (event.systemPromptOptions.forceSystemPrompt === undefined) return undefined;
      const systemPrompt = appendAddon(event.systemPrompt, addon);
      return systemPrompt === undefined ? undefined : { systemPrompt };
    });

    // 每次调用模型前读副本，运行途中的修改下一次调用即生效；结果只进请求，不进 transcript。
    pi.on("context_with_system", (event, ctx) => {
      const addon = ensureSessionAddon(agentDir, ctx.sessionManager.getSessionId());
      const content = appendAddon(getCurrentSystemPrompt(event.messages), addon);
      if (content === undefined) return undefined;
      const current = getCurrentSystemMessage(event.messages);
      return {
        messages: [
          {
            role: "system" as const,
            content,
            ...(current?.toolsAdded ? { toolsAdded: current.toolsAdded } : {}),
            timestamp: current?.timestamp ?? Date.now(),
          },
          ...event.messages.filter((message) => message.role !== "system"),
        ],
      };
    });
  };
}

export default function (pi: ExtensionAPI) {
  createExtension(getAgentDir())(pi);
}
