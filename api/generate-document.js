// =======================================================
// /api/generate-document.js
// =======================================================
// Purpose: Securely generate DOCX (and optional PDF later)
// Features:
// ✅ Uses safeRenderDocx() to avoid EROFS and render errors
// ✅ Always returns structured JSON response
// ✅ Detects missing template or bad input gracefully
// =======================================================

import path from "path";
import { safeRenderDocx } from "@/lib/safeRenderDocx";

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

    // 2️⃣ Validate required input
    if (!template) {
      return res.status(400).json({
        ok: false,
        error: "Missing 'template' field.",
      });
    }

    // 3️⃣ Construct safe template path
    const templateFile = path.basename(template);
    const renderData = data || {};

    // 4️⃣ Call our safe DOCX renderer
    const result = await safeRenderDocx({ templateFile, renderData });

    // 5️⃣ Handle graceful success/failure
    if (!result.ok) {
      console.error("❌ SafeRender failed:", result.error);
      return res.status(500).json({
        ok: false,
        error: result.error,
        warnings: result.warnings || [],
      });
    }

    // 6️⃣ Everything worked!
    console.log("✅ Safe DOCX render complete:", result.docxPath);

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
    // 7️⃣ Catch any uncaught issue
    console.error("💥 Fatal API error:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "Unexpected server error.",
    });
  }
}
