// ======= Unified Document Generator =======
// Intelligent DOCX → PDF generator with CloudConvert + Local + DOCX fallback
// Fault-tolerant, binary-safe, tag-healing, and crash-proof

import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { execSync } from "child_process";
import CloudConvert from "cloudconvert";

// Initialize CloudConvert client (safe to keep even if API key missing)
const cloudConvert = process.env.CLOUDCONVERT_API_KEY
  ? new CloudConvert(process.env.CLOUDCONVERT_API_KEY)
  : null;

// -------------------------------------------------------------
// 🔍 Extract {{tags}} dynamically from DOCX content
function extractTags(content) {
  const regex = /{{\s*([^}\s]+)\s*}}/g;
  const found = new Set();
  let match;
  while ((match = regex.exec(content))) found.add(match[1]);
  return Array.from(found);
}

// -------------------------------------------------------------
// 🧩 Normalize legacy uppercase placeholders → lowercase JSON keys
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

// -------------------------------------------------------------
// 🛡 Safe rendering — auto-fill missing fields with empty values
function safeRender(doc, data, tags) {
  const copy = { ...data };
  tags.forEach((t) => {
    if (copy[t] === undefined) copy[t] = "";
  });

  try {
    doc.render(copy);
    return { ok: true, missing: [] };
  } catch (err) {
    const missing = (err.properties?.errors || []).map((e) => e.properties?.id);
    missing.forEach((t) => (copy[t] = ""));
    try {
      doc.render(copy);
      return { ok: true, missing };
    } catch (err2) {
      console.error("⚠️ Docxtemplater render failed twice:", err2);
      return { ok: false, error: err2.message };
    }
  }
}

// -------------------------------------------------------------
// ⚙️ MAIN HANDLER
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    // Extract and sanitize incoming data
    const { fullName, witness1Name, witness1Email, witness2Name, witness2Email } = req.body || {};

    const data = {
      fullName,
      witness1Name,
      witness1Email,
      witness2Name,
      witness2Email,
      signatureDate: new Date().toLocaleDateString(),
    };

    // Locate template file
    const templatePath = path.join(process.cwd(), "templates", "CommonCarryDeclaration.docx");
    if (!fs.existsSync(templatePath)) {
      return res.status(404).json({ ok: false, error: "Template not found" });
    }

    // Binary-safe read and normalization
    const binaryContent = fs.readFileSync(templatePath, "binary");
    const normalized = normalizeTags(binaryContent.toString());
    const tags = extractTags(normalized);

    const zip = new PizZip(normalized, { base64: false });
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

    // Render safely (never crashes)
    const renderResult = safeRender(doc, data, tags);

    // Save generated DOCX
    const outputDir = path.join(process.cwd(), "temp");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

    const outputDocxPath = path.join(outputDir, "CommonCarryDeclaration_output.docx");
    const outputPdfPath = path.join(outputDir, "CommonCarryDeclaration_output.pdf");

    fs.writeFileSync(outputDocxPath, doc.getZip().generate({ type: "nodebuffer" }));

    // =========================================================
    // 🧠 STEP 1: Try CloudConvert PDF generation
    if (cloudConvert) {
      try {
        const job = await cloudConvert.jobs.create({
          tasks: {
            "import-my-file": { operation: "import/upload" },
            "convert-my-file": {
              operation: "convert",
              input: "import-my-file",
              input_format: "docx",
              output_format: "pdf",
            },
            "export-my-file": { operation: "export/url", input: "convert-my-file" },
          },
        });

        const uploadTask = job.tasks.find((t) => t.name === "import-my-file");
        const uploadUrl = uploadTask.result.form.url;
        const formData = new FormData();
        for (const [key, value] of Object.entries(uploadTask.result.form.parameters)) {
          formData.append(key, value);
        }
        formData.append("file", fs.createReadStream(outputDocxPath));
        await fetch(uploadUrl, { method: "POST", body: formData });

        const completedJob = await cloudConvert.jobs.wait(job.id);
        const exportTask = completedJob.tasks.find((t) => t.name === "export-my-file");
        const fileUrl = exportTask.result.files[0].url;

        return res.status(200).json({
          ok: true,
          mode: "cloudconvert",
          message: "✅ PDF generated successfully via CloudConvert.",
          fileUrl,
          tagsFound: tags,
          renderResult,
        });
      } catch (err) {
        console.warn("⚠️ CloudConvert PDF generation failed:", err.message);
      }
    }

    // =========================================================
    // ⚙️ STEP 2: Try Local LibreOffice PDF conversion
    try {
      execSync(`libreoffice --headless --convert-to pdf "${outputDocxPath}" --outdir "${outputDir}"`);
      if (fs.existsSync(outputPdfPath)) {
        return res.status(200).json({
          ok: true,
          mode: "local",
          message: "✅ Local PDF generated successfully.",
          pdfPath: outputPdfPath,
          tagsFound: tags,
          renderResult,
        });
      }
    } catch (pdfErr) {
      console.warn("⚙️ Local PDF conversion failed:", pdfErr.message);
    }

    // =========================================================
    // 📄 STEP 3: Fallback — Return DOCX version only
    return res.status(200).json({
      ok: true,
      mode: "fallback",
      message: "⚙️ Fallback to DOCX — PDF unavailable, DOCX returned instead.",
      docxPath: outputDocxPath,
      tagsFound: tags,
      renderResult,
    });
  } catch (err) {
    console.error("❌ Fatal error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
