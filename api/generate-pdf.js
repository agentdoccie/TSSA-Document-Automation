// ======= /api/generate-pdf.js =======
import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { execSync } from "child_process"; // optional local PDF conversion (LibreOffice)

// 🔍 Extract all {{tags}} automatically from DOCX XML
function extractTags(content) {
  const regex = /{{\s*([^}\s]+)\s*}}/g;
  const found = new Set();
  let match;
  while ((match = regex.exec(content))) found.add(match[1]);
  return Array.from(found);
}

// 🧩 Normalize legacy placeholder names (fix uppercase)
function normalizeTags(content) {
  const map = {
    FULL_NAME: "fullName",
    WITNESS_1_NAME: "witness1Name",
    WITNESS_1_EMAIL: "witness1Email",
    WITNESS_2_NAME: "witness2Name",
    WITNESS_2_EMAIL: "witness2Email",
    SIGNATURE_DATE: "signatureDate",
  };
  for (const [oldTag, newTag] of Object.entries(map)) {
    const regex = new RegExp(`{{\\s*${oldTag}\\s*}}`, "g");
    content = content.replace(regex, `{{${newTag}}}`);
  }
  return content;
}

// 🛡 Safe render — auto-fill missing variables dynamically
function safeRender(doc, data, tags) {
  const copy = { ...data };
  tags.forEach((t) => {
    if (copy[t] === undefined) copy[t] = "";
  });

  try {
    doc.render(copy);
    return { ok: true, missing: [] };
  } catch (err) {
    console.warn("⚠️ SafeRender fallback:", err.message);
    const missing = (err.properties?.errors || []).map((e) => e.properties?.id);
    missing.forEach((t) => (copy[t] = ""));
    doc.render(copy);
    return { ok: true, missing };
  }
}

// ======= MAIN HANDLER =======
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const { fullName, witness1Name, witness1Email, witness2Name, witness2Email } = req.body;

    // Template data with defaults
    const data = {
      fullName,
      witness1Name,
      witness1Email,
      witness2Name,
      witness2Email,
      signatureDate: new Date().toLocaleDateString(),
    };

    const templatePath = path.join(process.cwd(), "templates", "CommonCarryDeclaration.docx");
    if (!fs.existsSync(templatePath)) {
      return res.status(404).json({ ok: false, error: "Template not found" });
    }

    // ✅ Binary-safe read
    const binaryContent = fs.readFileSync(templatePath, "binary");

    // 🧩 Normalize placeholders + detect tags
    const normalized = normalizeTags(binaryContent.toString());
    const tags = extractTags(normalized);

    // 🧱 Create zip + template engine
    const zip = new PizZip(normalized, { base64: false });
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

    // 🧠 Render without crashing
    const renderResult = safeRender(doc, data, tags);

    // 🗂 Save DOCX output
    const outputDir = path.join(process.cwd(), "temp");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

    const outputDocxPath = path.join(outputDir, "CommonCarryDeclaration_output.docx");
    const outputPdfPath = path.join(outputDir, "CommonCarryDeclaration_output.pdf");

    const buffer = doc.getZip().generate({ type: "nodebuffer" });
    fs.writeFileSync(outputDocxPath, buffer);

    // ⚙️ Try local PDF conversion (LibreOffice)
    try {
      execSync(`libreoffice --headless --convert-to pdf "${outputDocxPath}" --outdir "${outputDir}"`);
      if (fs.existsSync(outputPdfPath)) {
        return res.status(200).json({
          ok: true,
          message: "✅ Local PDF generated successfully (auto-healing mode).",
          pdfPath: outputPdfPath,
          tagsFound: tags,
          renderResult,
        });
      } else {
        throw new Error("LibreOffice PDF conversion failed.");
      }
    } catch (pdfErr) {
      console.warn("⚠️ Local PDF conversion failed:", pdfErr.message);
      return res.status(200).json({
        ok: true,
        message: "⚙️ Fallback to DOCX — PDF conversion unavailable.",
        fallback: "docx",
        tagsFound: tags,
        renderResult,
      });
    }
  } catch (err) {
    console.error("❌ Generator fatal error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
