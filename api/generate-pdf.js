// /api/generate-pdf.js
// DOCX → PDF via CloudConvert (import/base64 → convert → export/url)
// Returns JSON: { ok: true, pdfUrl, filename } for the front-end to download.

import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res) {
  // Only POST
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  // Basic body parsing & validation
  const {
    fullName = "",
    witness1Name = "",
    witness1Email = "",
    witness2Name = "",
    witness2Email = "",
  } = req.body || {};

  const bad = (v) => typeof v !== "string" || v.trim().length === 0;
  if ([fullName, witness1Name, witness1Email, witness2Name, witness2Email].some(bad)) {
    return res.status(400).json({ ok: false, error: "Missing required fields." });
  }

  // CloudConvert key
  const ccKey = process.env.CLOUDCONVERT_API_KEY || "";
  if (!ccKey.trim()) {
    return res.status(500).json({ ok: false, error: "Server misconfigured: missing CLOUDCONVERT_API_KEY" });
  }

  // Load and render the DOCX template
  const templatePath = path.join(process.cwd(), "templates", "CommonCarryDeclaration.docx");
  if (!fs.existsSync(templatePath)) {
    return res.status(500).json({ ok: false, error: "Template not found on server." });
  }

  let nodebuf;
  try {
    const content = fs.readFileSync(templatePath, "binary");
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

    doc.render({
      FULL_NAME: fullName,
      WITNESS_1_NAME: witness1Name,
      WITNESS_1_EMAIL: witness1Email,
      WITNESS_2_NAME: witness2Name,
      WITNESS_2_EMAIL: witness2Email,
    });

    nodebuf = doc.getZip().generate({ type: "nodebuffer" });
  } catch (e) {
    console.error("DOCX render failed:", e);
    return res.status(500).json({ ok: false, error: "Failed to render document." });
  }

  // Create CloudConvert job: import/base64 → convert(pdf) → export/url
  let jobId;
  try {
    const createResp = await fetch("https://api.cloudconvert.com/v2/jobs", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ccKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tasks: {
          "import-my-file": {
            operation: "import/base64",
            file: nodebuf.toString("base64"),
            filename: "CommonCarryDeclaration.docx",
          },
          "convert-my-file": {
            operation: "convert",
            input: "import-my-file",
            output_format: "pdf",
            // LibreOffice engine is widely compatible for DOCX→PDF
            engine: "libreoffice",
          },
          "export-my-file": {
            operation: "export/url",
            input: "convert-my-file",
          },
        },
      }),
    });

    const createJson = await createResp.json();
    if (!createResp.ok) {
      console.error("CloudConvert job create failed:", createJson);
      return res.status(createResp.status).json({
        ok: false,
        error: `CloudConvert job create failed (${createResp.status}).`,
      });
    }

    jobId = createJson?.data?.id;
    if (!jobId) throw new Error("No job id returned");
  } catch (e) {
    console.error("CloudConvert job creation error:", e);
    return res.status(502).json({ ok: false, error: "CloudConvert unavailable (job creation)." });
  }

  // Poll until job is finished (or errored)
  let pdfUrl = null;
  try {
    for (let i = 0; i < 30; i++) {
      await sleep(1500);
      const jobResp = await fetch(`https://api.cloudconvert.com/v2/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${ccKey}` },
      });
      const jobJson = await jobResp.json();

      const status = jobJson?.data?.status;
      if (status === "finished") {
        const exportTask = (jobJson?.data?.tasks || []).find((t) => t.operation === "export/url");
        pdfUrl = exportTask?.result?.files?.[0]?.url || null;
        break;
      }
      if (status === "error") {
        console.error("CloudConvert job error:", jobJson);
        return res.status(502).json({ ok: false, error: "CloudConvert reported an error." });
      }
    }
  } catch (e) {
    console.error("CloudConvert polling error:", e);
    return res.status(502).json({ ok: false, error: "CloudConvert polling failed." });
  }

  if (!pdfUrl) {
    return res.status(504).json({ ok: false, error: "Timed out waiting for PDF." });
  }

  // Respond with a JSON payload the front-end already expects
  const safeName = `${fullName.replace(/[^a-z0-9_\-]+/gi, "_") || "Declaration"}.pdf`;
  return res.status(200).json({ ok: true, pdfUrl, filename: safeName });
}
