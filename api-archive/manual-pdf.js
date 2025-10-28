// File: /api/manual-pdf.js
import fs from "fs";
import path from "path";
import { promisify } from "util";
import CloudConvert from "cloudconvert";

const readFile = promisify(fs.readFile);
const cloudConvert = new CloudConvert(process.env.CLOUDCONVERT_API_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const { fileName } = req.body;

    if (!fileName) {
      return res.status(400).json({ ok: false, error: "Missing fileName in request body" });
    }

    const filePath = path.join(process.cwd(), "temp", fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ ok: false, error: "DOCX file not found" });
    }

    const fileBuffer = await readFile(filePath);

    // Convert DOCX → PDF via CloudConvert
    const job = await cloudConvert.jobs.create({
      tasks: {
        importBuffer: { operation: "import/upload" },
        convert: {
          operation: "convert",
          input: "importBuffer",
          input_format: "docx",
          output_format: "pdf",
        },
        exportFile: { operation: "export/url", input: "convert" },
      },
    });

    const uploadTask = job.tasks.find(t => t.name === "importBuffer");
    await cloudConvert.tasks.upload(uploadTask, fileBuffer);

    const updatedJob = await cloudConvert.jobs.wait(job.id);
    const exportTask = updatedJob.tasks.find(t => t.operation === "export/url");
    const fileUrl = exportTask.result.files[0].url;

    return res.status(200).json({
      ok: true,
      message: "✅ DOCX successfully converted to PDF",
      fileUrl,
    });
  } catch (error) {
    console.error("❌ Manual PDF conversion failed:", error);
    return res.status(500).json({
      ok: false,
      error: "Failed to convert DOCX to PDF",
      details: error.message,
    });
  }
}
