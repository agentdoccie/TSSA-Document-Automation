// File: /api/watchdog-template.js
import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const { fileName } = req.body;
    if (!fileName) {
      return res.status(400).json({ ok: false, error: "Missing fileName in body" });
    }

    const filePath = path.join(process.cwd(), "templates", fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ ok: false, error: "Template file not found" });
    }

    const content = fs.readFileSync(filePath, "binary");
    const zip = new PizZip(content);
    const reports = [];

    zip.forEach((relativePath, file) => {
      if (!relativePath.endsWith(".xml")) return;

      let xml = file.asText();

      // 1️⃣ Fix stray braces or spaces inside tags
      const braceFix = xml.replace(/{{\s+/g, "{{").replace(/\s+}}/g, "}}");
      if (braceFix !== xml) {
        reports.push("Cleaned extra spaces around template tags");
        xml = braceFix;
      }

      // 2️⃣ Convert snake_case / uppercase placeholders to camelCase
      const caseFix = xml.replace(/{{\s*([A-Z_]+)\s*}}/g, (_, key) => {
        const camel = key
          .toLowerCase()
          .replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
        reports.push(`Renamed {{${key}}} → {{${camel}}}`);
        return `{{${camel}}}`;
      });
      if (caseFix !== xml) xml = caseFix;

      // 3️⃣ Detect illegal characters (like brackets or colons)
      const illegalTags = xml.match(/{{[^}]*[^a-zA-Z0-9_{}]+[^}]*}}/g);
      if (illegalTags) {
        illegalTags.forEach(tag => {
          const safe = tag.replace(/[^a-zA-Z0-9{}]/g, "");
          reports.push(`Sanitized ${tag} → ${safe}`);
          xml = xml.replace(tag, safe);
        });
      }

      // 4️⃣ Remove empty or orphaned tags
      const emptyFix = xml.replace(/{{\s*}}/g, "[REMOVED_EMPTY_TAG]");
      if (emptyFix !== xml) {
        reports.push("Removed empty template placeholders");
        xml = emptyFix;
      }

      // 5️⃣ Validate render
      try {
        new Docxtemplater(new PizZip(xml));
      } catch {
        reports.push("Warning: Some tags remain invalid but were preserved safely");
      }

      // Replace file in zip
      zip.file(relativePath, xml);
    });

    // Write repaired copy
    const safeName = fileName.replace(/\.docx$/, "_checked.docx");
    const outPath = path.join(process.cwd(), "temp", safeName);
    const repairedContent = zip.generate({ type: "nodebuffer" });
    fs.writeFileSync(outPath, repairedContent);

    return res.status(200).json({
      ok: true,
      message: "✅ Template inspected and auto-corrected successfully.",
      repairedTemplate: safeName,
      reports,
    });
  } catch (error) {
    console.error("❌ Watchdog error:", error);
    return res.status(500).json({
      ok: false,
      error: "Watchdog failed to inspect template",
      details: error.message,
    });
  }
}
