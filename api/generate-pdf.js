// ======= /api/generate-pdf.js =======

import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { execSync } from "child_process"; // optional local PDF fallback (LibreOffice)

// 🧩 Helper: auto-repair placeholder names
function autoRepairTemplate(content) {
  const correctTags = {
    FULL_NAME: "fullName",
    WITNESS_1_NAME: "witness1Name",
    WITNESS_1_EMAIL: "witness1Email",
    WITNESS_2_NAME: "witness2Name",
    WITNESS_2_EMAIL: "witness2Email",
    SIGNATURE_DATE: "signatureDate",
  };

  let repairedContent = content;
  const replacements = [];

  for (const [wrongTag, rightTag] of Object.entries(correctTags)) {
    const regex = new RegExp(`{{\\s*${wrongTag}\\s*}}`, "g");
    if (regex.test(repairedContent)) {
      repairedContent = repairedContent.replace(regex, `{{${rightTag}}}`);
      replacements.push({ from: wrongTag, to: rightTag });
    }
  }

  return { repairedContent, replacements };
}

// 🛡️ Helper: Safe render (never crashes)
function safeRender(doc, data) {
  try {
    doc.render(data);
  } catch (error) {
    if (error.name === "MultiError" && Array.isArray(error.properties?.errors)) {
      const missing = error.properties.errors.map((e) => e.properties?.id || "unknown");
      console.warn("⚠️ Missing variables detected:", missing);
      // Fill missing keys with blanks and retry
      missing.forEach((key) => (data[key] = data[key] || ""));
      doc.render(data);
      return { ok: true, missing };
    } else {
      throw error;
    }
  }
  return { ok: true, missing: [] };
}

// ======= MAIN HANDLER =======
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const { fullName, witness1Name, witness1Email, witness2Name, witness2Email } = req.body;
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

    // ✅ Binary-safe read (no corruption)
    const binaryContent = fs.readFileSync(templatePath, "binary");

    // 🛠 Auto-repair placeholders
    const { repairedContent, replacements } = autoRepairTemplate(binaryContent.toString());

    // 🧩 Create zip safely
    const zip = new PizZip(repairedContent, { base64: false });
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

    // ✅ Render without crashing
    const renderResult = safeRender(doc, data);

    // 🗂 Save rendered DOCX
    const outputDir = path.join(process.cwd(), "temp");
    const outputDocxPath = path.join(outputDir, "CommonCarryDeclaration_output.docx");
    const outputPdfPath = path.join(outputDir, "CommonCarryDeclaration_output.pdf");

    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

    const buffer = doc.getZip().generate({ type: "nodebuffer" });
    fs.writeFileSync(outputDocxPath, buffer);

    // 🧾 Optional local PDF conversion (if LibreOffice is available)
    try {
      execSync(`libreoffice --headless --convert-to pdf "${outputDocxPath}" --outdir "${outputDir}"`);
      if (fs.existsSync(outputPdfPath)) {
        return res.status(200).json({
          ok: true,
          message: "✅ Local PDF generated successfully (self-healing mode).",
          pdfPath: outputPdfPath,
          replacements,
          renderResult,
        });
      } else {
        throw new Error("LibreOffice conversion failed.");
      }
    } catch (pdfErr) {
      console.warn("⚙️ Local PDF conversion failed:", pdfErr.message);

      return res.status(200).json({
        ok: true,
        message: "⚙️ Fallback to DOCX — PDF conversion unavailable.",
        fallback: "docx",
        replacements,
        renderResult,
      });
    }
  } catch (err) {
    console.error("❌ Generator fatal error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
