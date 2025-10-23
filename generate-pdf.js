// TSSA — Fill DOCX template and return PDF
// Uses docxtemplater (fill placeholders) + CloudConvert (docx->pdf)

import fs from "fs/promises";
import path from "path";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import CloudConvert from "cloudconvert";

export const config = { runtime: "nodejs" };

const cloudconvertApiKey = process.env.CLOUDCONVERT_API_KEY;

// Small helper to read the raw body in Node runtime (no req.json here)
async function readJsonBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    // 1) Parse input
    const body = await readJsonBody(req);
    const safe = (t) => (typeof t === "string" ? t.trim() : "");
    const data = {
      FULL_NAME: safe(body.fullName),
      WITNESS1_NAME: safe(body.witness1Name),
      WITNESS1_EMAIL: safe(body.witness1Email || ""),
      WITNESS2_NAME: safe(body.witness2Name),
      WITNESS2_EMAIL: safe(body.witness2Email || ""),
      SIGNATURE_DATE: safe(body.signatureDate || new Date().toLocaleDateString())
    };

    if (!data.FULL_NAME || !data.WITNESS1_NAME || !data.WITNESS2_NAME) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    // 2) Load the .docx template from /templates
    const templatePath = path.join(process.cwd(), "templates", "CommonCarryDeclaration.docx");
    const templateBinary = await fs.readFile(templatePath, "binary");

    // 3) Fill placeholders
    const zip = new PizZip(templateBinary);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
    doc.setData(data);
    doc.render(); // throws if a placeholder is missing
    const filledDocxBuffer = doc.getZip().generate({ type: "nodebuffer" });

    // 4) Convert DOCX -> PDF via CloudConvert (needs API key in Vercel)
    if (!cloudconvertApiKey) {
      // Fallback: return DOCX if no API key configured
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${data.FULL_NAME.replace(/\s+/g, "_")}_Declaration.docx"`
      );
      res.status(200).send(filledDocxBuffer);
      return;
    }

    const cloudConvert = new CloudConvert(cloudconvertApiKey);

    // Create job: upload -> convert -> export URL
    const job = await cloudConvert.jobs.create({
      tasks: {
        "import-file": { operation: "import/upload" },
        convert: {
          operation: "convert",
          input: "import-file",
          input_format: "docx",
          output_format: "pdf"
        },
        "export-url": { operation: "export/url", input: "convert" }
      }
    });

    const importTask = job.tasks.find((t) => t.name === "import-file");
    await cloudConvert.tasks.upload(importTask, filledDocxBuffer, "filled.docx");

    const done = await cloudConvert.jobs.wait(job.id);
    const exportTask = done.tasks.find((t) => t.name === "export-url" && t.status === "finished");
    const file = exportTask.result.files[0];

    // Fetch the PDF bytes from CloudConvert’s temporary URL
    const resp = await fetch(file.url);
    const arrayBuffer = await resp.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);

    // 5) Return PDF
    const filename = `${data.FULL_NAME.replace(/\s+/g, "_")}_Declaration.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.status(200).send(pdfBuffer);
  } catch (err) {
    console.error("PDF generation error:", err);
    res.status(500).json({ error: err?.message || String(err) });
  }
}
