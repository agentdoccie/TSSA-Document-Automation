// ========================================
// /api/debug-template.js
// Auto-detects and repairs DOCX placeholder tags
// ========================================

import fs from "fs";
import path from "path";
import PizZip from "pizzip";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { template } = req.body;
    if (!template) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing 'template' field" });
    }

    const templatePath = path.join(process.cwd(), "templates", template);
    if (!fs.existsSync(templatePath)) {
      return res
        .status(404)
        .json({ ok: false, error: `Template not found: ${template}` });
    }

    // --- Binary-safe read
    const binaryContent = fs.readFileSync(templatePath, "binary");
    const zip = new PizZip(binaryContent);

    // --- Extract text content from DOCX
    const docXml = zip.files["word/document.xml"].asText();

    // --- Find placeholders {{...}}
    const regex = /{{\s*([^}\s]+)\s*}}/g;
    const found = new Set();
    let match;
    while ((match = regex.exec(docXml))) found.add(match[1]);

    // --- Prepare mapping for known keys
    const mapping = {
      FULL_NAME: "fullName",
      WITNESS_1_NAME: "witness1Name",
      WITNESS_1_EMAIL: "witness1Email",
      WITNESS_2_NAME: "witness2Name",
      WITNESS_2_EMAIL: "witness2Email",
      SIGNATURE_DATE: "signatureDate",
    };

    // --- Normalize tags
    let fixedXml = docXml;
    Object.entries(mapping).forEach(([oldTag, newTag]) => {
      const regexOld = new RegExp(`{{\\s*${oldTag}\\s*}}`, "g");
      fixedXml = fixedXml.replace(regexOld, `{{${newTag}}}`);
    });

    // --- Write a corrected version
    const fixedFileName = template.replace(".docx", "_fixed.docx");
    const outputPath = path.join(process.cwd(), "templates", fixedFileName);

    try {
      zip.file("word/document.xml", fixedXml);
      const outputBuffer = zip.generate({ type: "nodebuffer" });

      // Explicitly log and confirm file creation
      fs.writeFileSync(outputPath, outputBuffer);
      console.log(`✅ Fixed DOCX saved at: ${outputPath}`);

      return res.status(200).json({
        ok: true,
        message: "✅ Template scanned and repaired successfully.",
        totalTags: found.size,
        tagsFound: Array.from(found),
        repairedFile: fixedFileName,
      });
    } catch (writeErr) {
      console.error("❌ Failed to write repaired DOCX:", writeErr);
      return res.status(500).json({
        ok: false,
        error: "Failed to save repaired DOCX file",
        details: writeErr.message,
      });
    }
  } catch (err) {
    console.error("❌ Debug-template error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
