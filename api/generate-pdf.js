// api/generate-pdf.js
import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import CloudConvert from "cloudconvert";

const TEMPLATE_FILE = path.join(process.cwd(), "templates", "CommonCarryDeclaration.docx");

function safe(t) {
  return typeof t === "string" ? t.trim() : "";
}

// helper to log and respond safely
function fail(res, status, code, detail) {
  console.error(`[generate-pdf][${code}]`, detail);
  return res.status(status).json({ ok: false, code, error: String(detail || "Unknown error") });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return fail(res, 405, "METHOD_NOT_ALLOWED", "Use POST");
  }

  // 1️⃣ Validate input
  let fullName, witness1Name, witness1Email, witness2Name, witness2Email;
  try {
    ({ fullName, witness1Name, witness1Email, witness2Name, witness2Email } = req.body || {});
    fullName = safe(fullName);
    witness1Name = safe(witness1Name);
    witness1Email = safe(witness1Email);
    witness2Name = safe(witness2Name);
    witness2Email = safe(witness2Email);

    if (!fullName || !witness1Name || !witness2Name) {
      return fail(res, 400, "VALIDATION", "Full name and both witness names are required.");
    }
  } catch (e) {
    return fail(res, 400, "BAD_JSON", e);
  }

  // 2️⃣ Ensure template is readable
  let templateBuffer;
  try {
    templateBuffer = fs.readFileSync(TEMPLATE_FILE);
  } catch (e) {
    return fail(res, 500, "TEMPLATE_READ", `Template not found or unreadable at ${TEMPLATE_FILE}`);
  }

  // 3️⃣ Render DOCX
  let docxBuffer;
  try {
    const zip = new PizZip(templateBuffer);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

    doc.render({
      FULL_NAME: fullName,
      WITNESS_1_NAME: witness1Name,
      WITNESS_1_EMAIL: witness1Email,
      WITNESS_2_NAME: witness2Name,
      WITNESS_2_EMAIL: witness2Email,
    });

    docxBuffer = doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
  } catch (e) {
    return fail(res, 500, "DOCX_RENDER", e.message || e);
  }

  // 4️⃣ CloudConvert → try PDF, fallback to DOCX
  const apiKey = process.env.CLOUDCONVERT_API_KEY;
  if (!apiKey) {
    console.warn("[generate-pdf] No CLOUDCONVERT_API_KEY found. Returning DOCX fallback.");
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fullName || "Declaration"}.docx"`);
    return res.status(200).send(docxBuffer);
  }

  try {
    const cloudConvert = new CloudConvert(apiKey);

    const job = await cloudConvert.jobs.create({
      tasks: {
        "import-my-file": {
          operation: "import/base64",
          file: docxBuffer.toString("base64"),
          filename: `${fullName || "Declaration"}.docx`,
        },
        "convert-my-file": {
          operation: "convert",
          input: "import-my-file",
          input_format: "docx",
          output_format: "pdf",
          engine: "office",
        },
        "export-my-file": {
          operation: "export/url",
          input: "convert-my-file",
          inline: false,
          archive_multiple_files: false,
        },
      },
      tag: "tssa-generate-pdf",
    });

    const completed = await cloudConvert.jobs.wait(job.id, { poll_interval: 1000 });
    const exportTask = completed.tasks.find(t => t.name === "export-my-file" && t.status === "finished");

    if (!exportTask || !exportTask.result?.files?.[0]) {
      throw new Error("PDF export missing in CloudConvert result.");
    }

    const pdfUrl = exportTask.result.files[0].url;
    const r = await fetch(pdfUrl);
    if (!r.ok) throw new Error(`Failed to fetch PDF (${r.status})`);
    const pdfArrayBuffer = await r.arrayBuffer();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fullName || "Declaration"}.pdf"`);
    return res.status(200).send(Buffer.from(pdfArrayBuffer));
  } catch (e) {
    console.error("[generate-pdf][CLOUDCONVERT_FAIL]", e?.response?.data || e?.message || e);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fullName || "Declaration"}.docx"`);
    return res.status(200).send(docxBuffer);
  }
}
