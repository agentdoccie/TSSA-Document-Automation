// lib/metrics.js — simple JSON-backed metrics store (uptime, health, generation count)
import fs from "fs";
import path from "path";

const logDir = path.join(process.cwd(), "logs");
const metricsFile = path.join(logDir, "metrics.json");

function ensure() {
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  if (!fs.existsSync(metricsFile)) {
    const now = Date.now();
    fs.writeFileSync(
      metricsFile,
      JSON.stringify(
        {
          startTime: now,
          lastHealthTime: null,
          lastDocGenerationTime: null,
          generationCount: 0,
        },
        null,
        2
      )
    );
  }
}

function load() {
  ensure();
  try {
    return JSON.parse(fs.readFileSync(metricsFile, "utf8"));
  } catch {
    return { startTime: Date.now(), generationCount: 0 };
  }
}

function save(data) {
  ensure();
  fs.writeFileSync(metricsFile, JSON.stringify(data, null, 2));
}

export function getMetrics() {
  const m = load();
  const now = Date.now();
  const uptimeSeconds = Math.max(
    0,
    Math.floor((now - (m.startTime || now)) / 1000)
  );
  return { ...m, uptimeSeconds };
}

export function touchHealth() {
  const m = load();
  m.lastHealthTime = Date.now();
  save(m);
  return getMetrics();
}

export function recordGeneration() {
  const m = load();
  m.lastDocGenerationTime = Date.now();
  m.generationCount = (m.generationCount || 0) + 1;
  save(m);
  return getMetrics();
}