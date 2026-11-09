import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { createAgentSessionFromServices, createAgentSessionServices, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { appendAddon, ensureSessionAddon, sessionAddonPath } = await jiti.import("./index.ts");
const extensionPath = join(dirname(fileURLToPath(import.meta.url)), "index.ts");

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "pi-addon-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const writeDefault = (dir, text) => writeFileSync(join(dir, "pi-web-system-prompt-addon.json"), JSON.stringify({ version: 1, text }));
function writeSession(dir, id, value) {
  const path = sessionAddonPath(dir, id);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ version: 1, ...value }));
}

test("a session snapshots the default once, off by default", (t) => {
  const dir = tempDir(t);
  writeDefault(dir, "one");
  assert.deepEqual(ensureSessionAddon(dir, "a"), { enabled: false, text: "one" });
  writeDefault(dir, "two");
  assert.deepEqual(ensureSessionAddon(dir, "a"), { enabled: false, text: "one" });
  assert.equal(JSON.parse(readFileSync(sessionAddonPath(dir, "a"), "utf8")).version, 1);
});

test("rejects session ids that would escape the directory", () => {
  assert.throws(() => sessionAddonPath("/tmp", "../evil"), RangeError);
});

test("appends only when enabled and non-blank", () => {
  assert.equal(appendAddon("Base\n", { enabled: true, text: " Extra\n" }), "Base\n\nExtra");
  assert.equal(appendAddon(" ", { enabled: true, text: "Extra" }), "Extra");
  assert.equal(appendAddon("Base", { enabled: false, text: "Extra" }), undefined);
  assert.equal(appendAddon("Base", { enabled: true, text: " " }), undefined);
});

// 走 SDK 真实的扩展加载器（别名后的 pi-ai 视图），并让扩展读这个目录。
async function createSession(t, dir) {
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  });
  const faux = fauxProvider({ models: [{ id: "faux-model" }] });
  const modelRuntime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  const services = await createAgentSessionServices({
    cwd: dir,
    agentDir: dir,
    modelRuntime,
    settingsManager: SettingsManager.inMemory(),
    resourceLoaderOptions: {
      additionalExtensionPaths: [extensionPath],
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      noContextFiles: true,
    },
  });
  const { errors } = services.resourceLoader.getExtensions();
  assert.deepEqual(errors, []);
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager: SessionManager.inMemory(dir),
    model: faux.getModel("faux-model"),
  });
  t.after(() => session.dispose());
  await session.bindExtensions({});
  return { faux, session };
}

test("toggling or editing mid-run applies to the next model call and ignores the default", async (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, "target.txt"), "x");
  writeDefault(dir, "SNAPSHOT_MARKER");
  const { faux, session } = await createSession(t, dir);
  const id = session.sessionId;
  const seen = [];
  const see = (context) => seen.push(getCurrentSystemPrompt(context.messages));
  const readCall = () => fauxAssistantMessage([fauxToolCall("read", { path: join(dir, "target.txt") })], { stopReason: "toolUse" });

  faux.setResponses([
    (context) => { see(context); writeSession(dir, id, { enabled: true, text: "SNAPSHOT_MARKER" }); writeDefault(dir, "GLOBAL_EDIT"); return readCall(); },
    (context) => { see(context); writeSession(dir, id, { enabled: true, text: "EDITED_MARKER" }); return readCall(); },
    (context) => { see(context); writeSession(dir, id, { enabled: false, text: "EDITED_MARKER" }); return readCall(); },
    (context) => { see(context); return fauxAssistantMessage([fauxText("done")]); },
  ]);
  await session.prompt("hi");

  assert.equal(seen.length, 4);
  assert.doesNotMatch(seen[0], /SNAPSHOT_MARKER/);
  assert.match(seen[1], /SNAPSHOT_MARKER$/);
  assert.match(seen[2], /EDITED_MARKER$/);
  assert.equal(seen[3], seen[0]);
});
