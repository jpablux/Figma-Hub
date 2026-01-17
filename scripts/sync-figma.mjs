// scripts/sync-figma.mjs
// Node 18+ (uses global fetch)

import fs from "node:fs/promises";
import path from "node:path";

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;

// Choose ONE source of truth:
// - Team ID (recommended) -> script fetches all projects, then all files in each project
// - OR Project IDs -> script fetches only those projects
const FIGMA_TEAM_ID = process.env.FIGMA_TEAM_ID || "";
const FIGMA_PROJECT_IDS = (process.env.FIGMA_PROJECT_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const OUTPUT_PATH = process.env.OUTPUT_PATH || "design-index.json";

// Optional: you can constrain to specific project names (comma-separated)
// Example: "Web Projects UX UI,Email Library"
const PROJECT_NAME_ALLOWLIST = (process.env.PROJECT_NAME_ALLOWLIST || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!FIGMA_TOKEN) {
  throw new Error("Missing FIGMA_TOKEN env var");
}
if (!FIGMA_TEAM_ID && FIGMA_PROJECT_IDS.length === 0) {
  throw new Error("Provide FIGMA_TEAM_ID or FIGMA_PROJECT_IDS (comma-separated)");
}

const API_BASE = "https://api.figma.com/v1";

async function figmaGet(url) {
  const res = await fetch(url, {
    headers: {
      "X-Figma-Token": FIGMA_TOKEN,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Figma API error ${res.status} for ${url}: ${text}`);
  }

  return res.json();
}

async function getProjectsFromTeam(teamId) {
  const data = await figmaGet(`${API_BASE}/teams/${teamId}/projects`);
  // data.projects: [{ id, name }]
  return data.projects || [];
}

async function getFilesFromProject(projectId) {
  const data = await figmaGet(`${API_BASE}/projects/${projectId}/files`);
  // data.files: [{ key, name, last_modified, thumbnail_url }]
  return data.files || [];
}

function toEntry(file, projectName) {
  // "key" is the Figma file key (what you used manually before)
  const fileKey = file.key;

  // Use /design/ because your sample links use /design/
  // (Figma also supports /file/ depending on file type; /design/ works for design files)
  const figmaUrl = `https://www.figma.com/design/${fileKey}/${encodeURIComponent(
    file.name || "Untitled"
  )}`;

  return {
    id: fileKey,
    title: file.name || "Untitled",
    org: "Redmond",
    brandKey: null,        // Option 1 does not infer these
    category: [],
    path: [],              // (Option 2 can populate this later)
    status: "active",
    tags: [],
    thumb: null,           // Keep null; you can map this later if you want
    figmaUrl,
    updatedAt: file.last_modified || null,
    // helpful for debugging / later rules:
    _project: projectName || null,
  };
}

function stableSort(entries) {
  // Sort newest first; fallback by title
  return entries.sort((a, b) => {
    const da = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const db = b.updatedAt ? Date.parse(b.updatedAt) : 0;
    if (db !== da) return db - da;
    return (a.title || "").localeCompare(b.title || "");
  });
}

async function main() {
  let projects = [];

  if (FIGMA_PROJECT_IDS.length > 0) {
    // If project IDs are provided, we can’t fetch their names without another endpoint.
    // We'll treat the ID as the projectName placeholder.
    projects = FIGMA_PROJECT_IDS.map((id) => ({ id, name: id }));
  } else {
    projects = await getProjectsFromTeam(FIGMA_TEAM_ID);
  }

  if (PROJECT_NAME_ALLOWLIST.length > 0) {
    projects = projects.filter((p) => PROJECT_NAME_ALLOWLIST.includes(p.name));
  }

  const entries = [];
  for (const p of projects) {
    const files = await getFilesFromProject(p.id);
    for (const f of files) {
      entries.push(toEntry(f, p.name));
    }
  }

  const out = stableSort(entries);

  // Write JSON
  const json = JSON.stringify(out, null, 2) + "\n";
  const outPath = path.resolve(process.cwd(), OUTPUT_PATH);
  await fs.writeFile(outPath, json, "utf8");

  console.log(`Wrote ${out.length} entries to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
