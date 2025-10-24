// =======================================================
// /api/generate-document.js
// =======================================================
// Purpose: Securely generate DOCX (and optional PDF later)
// Features:
// ✅ Uses safeRenderDocx() to avoid EROFS and render errors
// ✅ Always returns structured JSON response
// ✅ Detects missing template or bad input gracefully
// ✅ Works on Vercel with /tmp safe writes and Node runtime
// =======================================================

export const config = {
  runtime: "nodejs18.x", // ⬅️ Ensures full Node features for fs/path
};

import path from "path";
import { safeRenderDocx } from "../../lib/safeRenderDocx.js";

export default async function handler(req, res) {
  console.log("⚙️ /api/generate-document invoked at:", new Date().toISOString());

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed – use POST only.",
    });
  }

  try {
    // 1️⃣ Parse JSON body
    const { template, data } = req.body || {};

    // 2️⃣ Validate required input
    if (!template) {
      console.error("❌ Missing 'template' in request.");
      return res.status(400).json({
        ok: false,
        error: "Missing 'template' field.",
      });
    }

    // 3️⃣ Construct safe template file path
    const templateFile = path.basename(template);
    const renderData = data || {};

    // 4️⃣ Log before render
    console.log("🧩 Starting safeRenderDocx:", { templateFile });

    // 5️⃣ Safely render document using isolated library
    const result = await safeRenderDocx({ templateFile, renderData });

    // 6️⃣ Handle any safeRenderDocx errors gracefully
    if (!result.ok) {
      console.error("❌ safeRenderDocx failed:", result.error);
      return res.status(500).json({
        ok: false,
        error: result.error || "safeRenderDocx failed",
        warnings: result.warnings || [],
      });
    }

    // 7️⃣ Log success
    console.log("✅ DOCX rendered successfully:", result.docxPath);

    // 8️⃣ Return structured response
    return res.status(200).json({
      ok: true,
      message: "✅ DOCX generated successfully.",
      docxPath: result.docxPath,
      tagsFound: result.tagsFound,
      usedData: result.usedData,
      warnings: result.warnings,
      correlationId: result.correlationId,
    });
  } catch (err) {
    console.error("💥 Uncaught error in /generate-document:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "Unexpected server error.",
    });
  }
}
