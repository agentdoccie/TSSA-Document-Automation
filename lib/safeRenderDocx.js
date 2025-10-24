// =======================================================
// lib/safeRenderDocx.js
// =======================================================
// Purpose: Safely render and repair DOCX templates
// Features:
// ✅ Auto-fixes missing tags (avoids XTTemplateError)
// ✅ Writes only to /tmp (Vercel-safe, read-only-proof)
// ✅ Returns doc path, tags, warnings, and correlation ID
// ✅ Never crashes – always returns structured output
// =======================================================

import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import crypto from "crypto";

export async function safeRenderDocx({ templateFile, renderData = {} }) {
  const correlationId = crypto.randomUUID();
  const outDir = "/tmp";
  const warnings = [];
  let tagsFound = [];

  try {
    // 1️⃣ Read and load the DOCX file safely
    const templatePath = path.join(process.cwd(), "templates", templateFile);
    const content = fs.readFileSync(templatePath, "binary");
    const zip = new PizZip(content);

    // 2️⃣ Load into Docxtemplater with full safety mode
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => "", // Prevent XTTemplateError
    });

    // 3️⃣ Extract all placeholder tags from XML
    const xml = zip.files["word/document.xml"].asText();
    const regex = /{{\s*([^}\s]+)\s*}}/g;
    let match;
    while ((match = regex.exec(xml))) {
      tagsFound.push(match[1]);
    }

    // 4️⃣ Auto-fill missing fields with blank fallback
    const allData = {};
    tagsFound.forEach((tag) => {
      allData[tag] = renderData[tag] || "";
    });

    // 5️⃣ Render the DOCX (gracefully handles errors)
    try {
      doc.render(allData);
    } catch (e) {
      warnings.push({
        kind: "render_warning",
        message: "Docxtemplater render warning; continuing with best effort.",
        detail: e.message,
      });
    }

    // 6️⃣ Generate nodebuffer and write ONLY to /tmp
    const outBuffer = doc.getZip().generate({ type: "nodebuffer" });
    const outName = templateFile.replace(/\.docx$/i, `_${correlationId}.docx`);
    const outPath = path.join(outDir, outName);
    fs.writeFileSync(outPath, outBuffer);

    // 7️⃣ Return full result
    return {
      ok: true,
      correlationId,
      docxPath: outPath,
      tagsFound,
      usedData: allData,
      warnings,
    };
  } catch (err) {
    // 8️⃣ Graceful failure fallback
    return {
      ok: false,
      correlationId,
      error: err.message || String(err),
      warnings,
    };
  }
}
