// ======= /api/generate-pdf.js =======
// CloudConvert-based serverless DOCX→PDF conversion.
// Validates template placeholders before rendering to prevent docxtemplater crashes.
// Returns 422 with missing placeholders instead of a 500 stack trace.

import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import CloudConvert from "cloudconvert";
import fetch from "node-fetch";
import { validateDataAgainstTemplate } from "../lib/template-validator.js";

// Fallback helper: normalize legacy uppercase placeholders to the camelCase fields used by the UI.
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

// Safe render that fills missing keys with empty string as a last-resort fallback.
function safeRender(doc, data) {
  const copy = { ...data };
  Object.keys(copy).forEach((k) => {
    if (copy[k] === undefined) copy[k] = "";
  });

  try {
    doc.render(copy);
    return { ok: true, missing: [] };
  } catch (err) {
    const missing =
      (err?.properties?.errors || []).map((e) => e.properties?.id).filter(Boolean) || [];
    missing.forEach((m) => (copy[m] = ""));
    try {
      doc.render(copy);
      return { ok: true, missing };
    } catch (secondErr) {
      throw secondErr || err;
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    // Check for CloudConvert API key
    if (!process.env.CLOUDCONVERT_API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Server configuration error: CLOUDCONVERT_API_KEY not set",
      });
    }

    const { fullName, witness1Name, witness1Email, witness2Name, witness2Email } =
      req.body || {};

    const dataCamel = {
      fullName,
      witness1Name,
      witness1Email,
      witness2Name,
      witness2Email,
      signatureDate: new Date().toLocaleDateString(),
    };

    const dataUpper = {
      FULL_NAME: fullName,
      SIGNATURE_DATE: dataCamel.signatureDate,
      WITNESS_1_NAME: witness1Name,
      WITNESS_1_EMAIL: witness1Email,
      WITNESS_2_NAME: witness2Name,
      WITNESS_2_EMAIL: witness2Email,
    };

    const templateFile = "CommonCarryDeclaration.docx";
    const templatePath = path.join(process.cwd(), "templates", templateFile);
    if (!fs.existsSync(templatePath)) {
      return res.status(404).json({ ok: false, error: `Template not found: ${templateFile}` });
    }

    const buffer = fs.readFileSync(templatePath);

    let validation;
    try {
      validation = validateDataAgainstTemplate(buffer, dataUpper);
    } catch (vErr) {
      console.error("Template validation failure:", vErr);
      return res
        .status(500)
        .json({ ok: false, error: "Failed to read template tags", message: String(vErr.message) });
    }

    if (Array.isArray(validation.missing) && validation.missing.length > 0) {
      const schemaPath = path.join(
        process.cwd(),
        "templates",
        `${path.basename(templateFile, path.extname(templateFile))}.schema.json`
      );
      let example = dataUpper;
      try {
        if (fs.existsSync(schemaPath)) {
          const raw = fs.readFileSync(schemaPath, "utf8");
          example = JSON.parse(raw);
        }
      } catch (e) {}

      console.warn("Template missing placeholders:", validation.missing);
      return res.status(422).json({
        ok: false,
        error: "Template validation failed: missing placeholders",
        missing: validation.missing,
        requiredPlaceholders: validation.tags,
        examplePayload: example,
        message: `Template requires ${validation.tags.length} placeholders; ${validation.missing.length} are missing.`,
      });
    }

    const binaryContent = fs.readFileSync(templatePath, "binary");
    const normalized = normalizeTags(binaryContent.toString());

    const zip = new PizZip(normalized, { base64: false });
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

    let renderResult;
    try {
      renderResult = safeRender(doc, dataCamel);
    } catch (renderErr) {
      console.error("Render failed after fallback attempt:", renderErr);
      return res.status(500).json({ ok: false, error: "Failed to render template", message: String(renderErr.message) });
    }

    const outBuffer = doc.getZip().generate({ type: "nodebuffer" });

    // CloudConvert conversion
    try {
      const cloudconvert = new CloudConvert(process.env.CLOUDCONVERT_API_KEY);

      // Create job with import/upload -> convert -> export/url tasks
      const job = await cloudconvert.jobs.create({
        tasks: {
          "import-docx": {
            operation: "import/upload",
          },
          "convert-to-pdf": {
            operation: "convert",
            input: "import-docx",
            input_format: "docx",
            output_format: "pdf",
          },
          "export-pdf": {
            operation: "export/url",
            input: "convert-to-pdf",
          },
        },
      });

      // Find the upload task and upload the DOCX buffer
      const uploadTask = job.tasks.find((t) => t.name === "import-docx");
      if (!uploadTask || !uploadTask.result?.form) {
        throw new Error("CloudConvert upload task not found or invalid");
      }

      await cloudconvert.tasks.upload(uploadTask, outBuffer, `${templateFile.replace('.docx', '')}_output.docx`);

      // Wait for job completion
      const completedJob = await cloudconvert.jobs.wait(job.id);

      // Find the export task and get the PDF URL
      const exportTask = completedJob.tasks.find((t) => t.name === "export-pdf");
      if (!exportTask || !exportTask.result?.files?.[0]?.url) {
        throw new Error("CloudConvert export task failed or PDF URL not found");
      }

      const pdfUrl = exportTask.result.files[0].url;

      // Download the PDF
      const pdfResponse = await fetch(pdfUrl);
      if (!pdfResponse.ok) {
        throw new Error(`Failed to download PDF: ${pdfResponse.statusText}`);
      }

      const pdfBuffer = await pdfResponse.buffer();

      // Stream the PDF back as attachment
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${templateFile.replace('.docx', '')}_output.pdf"`
      );
      res.setHeader("Content-Length", pdfBuffer.length);
      return res.status(200).send(pdfBuffer);
    } catch (conversionErr) {
      console.error("CloudConvert conversion failed:", conversionErr);
      return res.status(500).json({
        ok: false,
        error: "PDF conversion failed",
        message: String(conversionErr?.message || conversionErr),
      });
    }
  } catch (err) {
    console.error("Generator fatal error:", err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}

