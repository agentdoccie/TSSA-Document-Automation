// ================================================
// /api/generate-document.js
// ================================================
// Purpose: Securely generate DOCX (and optional PDF later)
// Features:
// ✅ Uses safeRenderDocx() to avoid EROFS and render errors
// ✅ Always returns structured JSON response
// ✅ Detects missing template or bad input gracefully
// ✅ Works on Vercel with /tmp safe writes and Node runtime
// ================================================

export const config = {
  runtime: "nodejs18.x", // 🟦 Ensures full Node features for fs/path
};

import path from "path";
import fs from "fs";
import { safeRenderDocx } from "../../lib/safeRenderDocx.js";

// --- Self-healing runtime safeguard ---
process.on("uncaughtException", err => {
  console.error("💥 Uncaught Exception:", err);
});
process.on("unhandledRejection", reason => {
  console.error("💥 Unhandled Rejection:", reason);
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed – use POST only.",
    });
  }

  try {
    // 1️⃣ Parse JSON body
    const { template, data } = req.body || {};
    if (!template || typeof data !== "object") {
      return res.status(400).json({
        ok: false,
        error: "Missing or invalid request body. Expected { template, data }.",
      });
    }

    // 2️⃣ Validate template existence
    const templatePath = path.join(process.cwd(), "templates", template);
    if (!fs.existsSync(templatePath)) {
      return res.status(404).json({
        ok: false,
        error: `Template '${template}' not found in /templates`,
      });
    }

    console.log(`🧩 Starting render for template: ${template}`);

    // 3️⃣ Render securely (safeRenderDocx handles /tmp)
    const renderResult = await safeRenderDocx(templatePath, data);

    if (!renderResult.ok) {
      console.warn("⚠️ Safe render fallback triggered:", renderResult.error);
      return res.status(500).json({
        ok: false,
        message: "Render failed, fallback triggered.",
        details: renderResult,
      });
    }

    // 4️⃣ Respond success
    return res.status(200).json({
      ok: true,
      message: "✅ DOCX generated successfully.",
      result: renderResult,
    });
  } catch (err) {
    console.error("🔥 Fatal error in generate-document:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || String(err),
      stack: err.stack || null,
    });
  }
}
