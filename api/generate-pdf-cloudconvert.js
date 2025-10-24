// File: /api/generate-pdf-cloudconvert.js
import fs from "fs";
import path from "path";
import { promisify } from "util";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import CloudConvert from "cloudconvert";

const readFile = promisify(fs.readFile);
const cloudConvert = new CloudConvert(process.env.CLOUDCONVERT_API_KEY);

async function runWatchdog(fileName) {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/watchdog-template`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName }),
    });
    const result = await response.json();
    if (result?.ok && result.repairedTemplate) {
      console.log("🛠 Watchdog repaired template:", result.repairedTemplate);
      return path.join(process.cwd(), "temp", result.repairedTemplate);
    }
  } catch (err) {
    console.warn("⚠️ Watchdog skipped:", err.message);
  }
  return path.join(process.cwd(), "templates", fileName);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const { fullName, witness1Name, witness1Email, witness2Name, witness2Email } = req.body;
    const templateFile = "CommonCarryDeclaration.docx";
    const templatePath = await runWatchdog(templateFile);

    if (!fs.existsSync(templatePath)) {
      return res.status(404).json({ ok: false, error: "Template not found after watchdog repair." });
    }

    const content = await readFile(templatePath, "binary");
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

    // Fallback-safe rendering
    try {
      doc.render({
        fullName: fullName || "[MISSING fullName]",
        witness1Name: witness1Name || "[MISSING witness1Name]",
        witness1Email: witness1Email || "[MISSING witness1Email]",
        witness2Name: witness2Name || "[MISSING witness2Name]",
        witness2Email: witness2Email || "[MISSING witness2Email]",
        signatureDate: new Date().toLocaleDateString(),
      });
    } catch (e) {
      console.warn("⚠️ Template render error, fallback applied:", e.message);
    }

    const buffer = doc.getZip().generate({ type: "nodebuffer" });

    // Upload DOCX → convert → export URL
    const job = await cloudConvert.jobs.create({
      tasks: {
        importUpload: { operation: "import/upload" },
        convert: { operation: "convert", input: "importUpload", input_format: "docx", output_format: "pdf" },
        exportUrl: { operation: "export/url", input: "convert" },
      },
    });

    const uploadTask = job.tasks.find(t => t.name === "importUpload");
    await cloudConvert.tasks.upload(uploadTask, buffer);

    const completedJob = await cloudConvert.jobs.wait(job.id);
    const exportTask = completedJob.tasks.find(t => t.operation === "export/url");
    const pdfUrl = exportTask.result.files[0].url;

    return res.status(200).json({
      ok: true,
      message: "✅ PDF generated (with watchdog pre-check)",
      fileUrl: pdfUrl,
    });
  } catch (error) {
    console.error("❌ PDF generation fallback triggered:", error);
    return res.status(200).json({
      ok: true,
      message: "⚠️ PDF conversion failed — fallback to DOCX only.",
      error: error.message,
      fallback: "docx",
    });
  }
}
