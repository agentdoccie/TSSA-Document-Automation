// api/generate-all.js
import fs from "fs";
import path from "path";
import JSZip from "jszip";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { recordGeneration } from "../lib/metrics.js";
import { PDFDocument } from "pdf-lib"; // for PDF conversion (if needed)
import fetch from "node-fetch";

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const { templates, data, outputFormat = "docx", upload = false } = req.body;

    if (!Array.isArray(templates) || templates.length === 0) {
      return res.status(400).json({ error: "Missing templates array" });
    }
    if (typeof data !== "object" || data == null) {
      return res.status(400).json({ error: "Missing data object" });
    }

    const templatesDir = path.join(process.cwd(), "templates");
    const zip = new JSZip();

    for (const tplName of templates) {
      const tplPath = path.join(templatesDir, tplName);
      if (!fs.existsSync(tplPath)) {
        return res.status(404).json({ error: `Template not found: ${tplName}` });
      }

      const content = fs.readFileSync(tplPath);
      const piz = new PizZip(content);
      const doc = new Docxtemplater(piz, {
        paragraphLoop: true,
        linebreaks: true,
      });
      doc.setData(data);
      doc.render();

      const renderedBuffer = doc.getZip().generate({ type: "nodebuffer" });
      const baseName = path.basename(tplName, path.extname(tplName));

      // Optional PDF generation (convert docx → pdf)
      if (outputFormat === "pdf") {
        const pdf = await convertToPdf(renderedBuffer);
        zip.file(`${baseName}.pdf`, pdf);
      } else {
        zip.file(`${baseName}.docx`, renderedBuffer);
      }
    }

    const zipBuf = await zip.generateAsync({ type: "nodebuffer" });
    recordGeneration();

    // Optional cloud upload step
    if (upload) {
      const cloudUrl = await uploadToCloud(zipBuf);
      return res.status(200).json({
        message: "Document generated and uploaded successfully",
        url: cloudUrl,
      });
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="generated-documents.zip"'
    );
    return res.status(200).send(zipBuf);
  } catch (err) {
    console.error("Error during generation:", err);
    return res.status(500).json({ error: "Generation failed", detail: err.message });
  }
}

// Optional helper: Convert DOCX buffer to PDF (simplified local version)
async function convertToPdf(docxBuffer) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([600, 800]);
  page.drawText("PDF Conversion Placeholder — replace with actual renderer");
  return await pdfDoc.save();
}

// Optional helper: Upload to cloud service (example placeholder)
async function uploadToCloud(buffer) {
  console.log("Uploading file to cloud (simulated)...");
  // Replace with actual upload logic (S3, Cloudinary, etc.)
  return "https://example.com/path/to/generated-documents.zip";
}