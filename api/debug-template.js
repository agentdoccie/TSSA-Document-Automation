// File: /api/debug-template.js
import fs from "fs";
import path from "path";
import PizZip from "pizzip";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const { fileName } = req.body;

    if (!fileName) {
      return res.status(400).json({ ok: false, error: "Missing fileName" });
    }

    const filePath = path.join(process.cwd(), "templates", fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ ok: false, error: "Template not found" });
    }

    const content = fs.readFileSync(filePath, "binary");
    const zip = new PizZip(content);

    let tags = [];
    zip.forEach((relativePath, file) => {
      const text = file.asText();
      const matches = text.match(/{{(.*?)}}/g);
      if (matches) {
        matches.forEach(tag => tags.push(tag.replace(/[{}]/g, "")));
      }
    });

    return res.status(200).json({
      ok: true,
      message: "✅ Template scanned successfully",
      totalPlaceholders: tags.length,
      placeholders: Array.from(new Set(tags)),
    });
  } catch (error) {
    console.error("❌ Template debug failed:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
