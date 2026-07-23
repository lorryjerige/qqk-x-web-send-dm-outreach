import { readdir, readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "README.md",
  "README.zh-CN.md",
  "LICENSE",
  "SECURITY.md",
  "skill/config.json",
  "skill/qqk-skill.json",
  "skill/modules/cdp-session.mjs",
  "skill/modules/send-direct-message.mjs",
  "skill/modules/send-dm-outreach.mjs",
  "skill/modules/x-web-skill-runtime.mjs",
  "docs/ARCHITECTURE.md",
  "docs/INSTALLATION.md",
  "docs/RESPONSIBLE_USE.md",
  "docs/SKILL_REFERENCE.md",
  "docs/TROUBLESHOOTING.md",
  "examples/prompts.md",
  "examples/task-report.sample.json"
];

const jsonFiles = [
  "package.json",
  "skill/config.json",
  "skill/qqk-skill.json",
  "examples/task-report.sample.json"
];

const moduleFiles = [
  "skill/modules/cdp-session.mjs",
  "skill/modules/send-direct-message.mjs",
  "skill/modules/send-dm-outreach.mjs",
  "skill/modules/x-web-skill-runtime.mjs",
  "tools/validate-repository.mjs"
];

const failures = [];

for (const relativePath of requiredFiles) {
  try {
    const info = await stat(resolve(root, relativePath));
    if (!info.isFile()) failures.push(`${relativePath} is not a file`);
  } catch {
    failures.push(`Missing required file: ${relativePath}`);
  }
}

const parsedJson = new Map();
for (const relativePath of jsonFiles) {
  try {
    parsedJson.set(relativePath, JSON.parse(await readFile(resolve(root, relativePath), "utf8")));
  } catch (error) {
    failures.push(`Invalid JSON in ${relativePath}: ${error.message}`);
  }
}

for (const relativePath of moduleFiles) {
  const result = spawnSync(process.execPath, ["--check", resolve(root, relativePath)], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    failures.push(`JavaScript syntax check failed for ${relativePath}: ${result.stderr || result.stdout}`);
  }
}

const manifest = parsedJson.get("skill/qqk-skill.json");
if (manifest) {
  if (manifest.skill?.name !== "x_web_send_dm_outreach") failures.push("Manifest skill name is incorrect");
  if (manifest.skill?.version !== 8) failures.push("Manifest must package QQK skill version 8");
  if (manifest.workflow?.definition?.steps?.length !== 1) failures.push("Manifest workflow must contain exactly one step");
  if (manifest.workflow?.definition?.steps?.[0]?.action !== manifest.skill?.name) failures.push("Workflow action must match the skill name");
  if (manifest.skill?.inputSchema?.properties?.closeProfile?.default !== false) failures.push("closeProfile must default to false");
  if (manifest.skill?.inputSchema?.properties?.dryRun?.default !== true) failures.push("dryRun must default to true in the schema");
  for (const forbidden of ["send", "publish", "confirmRealRun"]) {
    if (Object.hasOwn(manifest.skill?.inputSchema?.properties || {}, forbidden)) {
      failures.push(`Public input schema must not declare ${forbidden}`);
    }
  }
  for (const requiredOutput of ["recipientsProcessed", "messagesAttempted", "messagesSucceeded", "conversationUrl"]) {
    if (!manifest.skill?.outputSchema?.required?.includes(requiredOutput)) {
      failures.push(`Output schema must require ${requiredOutput}`);
    }
  }
}

const config = parsedJson.get("skill/config.json");
if (config) {
  const templateIds = (config.invocationTemplates || []).map((item) => item.id);
  for (const expected of ["zh_complete", "en_complete", "zh_dry_run", "en_dry_run"]) {
    if (!templateIds.includes(expected)) failures.push(`Missing invocation template: ${expected}`);
  }
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if ([".git", "node_modules"].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

const allFiles = await listFiles(root);

for (const path of allFiles.filter((item) => item.toLowerCase().endsWith(".md"))) {
  const content = await readFile(path, "utf8");
  for (const match of content.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g)) {
    const href = match[1].trim().replace(/^<|>$/g, "");
    if (!href || href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
    const localTarget = decodeURIComponent(href.split("#")[0].split("?")[0]);
    try {
      await stat(resolve(dirname(path), localTarget));
    } catch {
      failures.push(`Broken local Markdown link in ${path.slice(root.length + 1)}: ${href}`);
    }
  }
}

const forbiddenPatterns = [
  { label: "Windows user path", pattern: /[A-Za-z]:\\Users\\/i },
  { label: "absolute local file URL", pattern: /file:\/\/\/[A-Za-z]:\//i },
  { label: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { label: "bearer credential", pattern: /Authorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/-]{12,}/i }
];

for (const path of allFiles) {
  const content = await readFile(path, "utf8").catch(() => "");
  for (const { label, pattern } of forbiddenPatterns) {
    if (pattern.test(content)) failures.push(`${label} found in ${path.slice(root.length + 1)}`);
  }
}

if (failures.length) {
  console.error(`Repository validation failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Repository validation passed.");
  console.log(`Checked ${requiredFiles.length} required artifacts, ${jsonFiles.length} JSON files, ${moduleFiles.length} JavaScript modules, and local Markdown links.`);
}
