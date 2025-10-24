// /api/generate-pdf-cloudconvert.js
// Generates the DOCX in-memory with Docxtemplater + PizZip,
// then uses CloudConvert (import/upload -> convert(pdf) -> export/url).
// If CloudConvert fails for any reason, we fall back to sending the DOCX.

import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

// Node 18+/Vercel provide fetch, FormData, Blob globally via undici.
// No need to import node-fetch or form-data.

// ---- tiny helpers ----
const has = (v) => typeof v === "string" && v.trim().length > 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  // 1) Gather & sanitize input (matches your front-end fields)
  const fullName = String(req.body.fullName || "").trim();
  const witness1Name = String(req.body.witness1Name || "").trim();
  const witness1Email = String(req.body.witness1Email || "").trim();
  const witness2Name = String(req.body.witness2Name || "").trim();
  const witness2Email = String(req.body.witness2Email || "").trim();

  // 2) Render DOCX in memory with Docxtemplater
  const templatePath = path.join(
    process.cwd(),
    "templates",
    "CommonCarryDeclaration.docx" // <- keep the name you actually have in /templates
  );

  let docxBuffer; // rendered DOCX buffer for fallback, and as CloudConvert input

  try {
    if (!fs.existsSync(templatePath)) {
      throw new Error("Template not found on server");
    }
    const content = fs.readFileSync(templatePath, "binary");
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

    // These keys must match your {{PLACEHOLDERS}} in the DOCX
    doc.render({
      FULL_NAME: fullName,
      WITNESS_1_NAME: witness1Name,
      WITNESS_1_EMAIL: witness1Email,
      WITNESS_2_NAME: witness2Name,
      WITNESS_2_EMAIL: witness2Email,
      SIGNATURE_DATE: new Date().toLocaleDateString(), // optional, if you included it
    });

    docxBuffer = doc.getZip().generate({ type: "nodebuffer" });
  } catch (e) {
    console.error("DOCX render failed:", e);
    return res
      .status(500)
      .json({ ok: false, error: "Failed to render document." });
  }

  // 3) Try CloudConvert DOCX -> PDF
  const ccKey = process.env.CLOUDCONVERT_API_KEY || "";
  if (!has(ccKey)) {
    console.warn("No CloudConvert API key; returning DOCX fallback.");
    return sendDocxFallback(res, docxBuffer);
  }

  try {
    // Create job: import/upload -> convert -> export/url
    const createJob = await fetch("https://api.cloudconvert.com/v2/jobs", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ccKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tasks: {
          import: { operation: "import/upload" },
          convert: {
            operation: "convert",
            input: "import",
            output_format: "pdf",
          },
          export: { operation: "export/url", input: "convert" },
        },
      }),
    });

    const jobJson = await createJob.json();
    if (!createJob.ok) {
      throw new Error(
        `CloudConvert job create failed (${createJob.status}): ${JSON.stringify(
          jobJson
        )}`
      );
    }

    const jobId = jobJson?.data?.id;
    const uploadTask = jobJson?.data?.tasks?.find((t) => t.name === "import");
    if (!uploadTask?.result?.form?.url) {
      throw new Error("CloudConvert: missing upload form data");
    }

    // Upload our DOCX buffer to the provided form
    const form = new FormData();
    // copy all required form fields:
    Object.entries(uploadTask.result.form.parameters || {}).forEach(([k, v]) =>
      form.append(k, v)
    );
    form.append(
      "file",
      new Blob(
        [docxBuffer],
        {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }
      ),
      "input.docx"
    );

    const uploadResp = await fetch(uploadTask.result.form.url, {
      method: "POST",
      body: form,
    });
    if (!uploadResp.ok) {
      throw new Error(`CloudConvert upload failed (${uploadResp.status})`);
    }

    // Poll job until finished
    let done = false;
    let tries = 0;
    let last;

    while (!done && tries < 30) {
      await sleep(1500);
      const jr = await fetch(`https://api.cloudconvert.com/v2/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${ccKey}` },
      });
      last = await jr.json();

      const status = last?.data?.status;
      if (status === "finished") {
        done = true;
        break;
      }
      if (status === "error") {
        throw new Error(
          `CloudConvert reported error: ${JSON.stringify(last?.data)}`
        );
      }
      tries++;
    }

    if (!done) {
      throw new Error("CloudConvert timeout waiting for conversion");
    }

    // Find the export task and fetch the generated PDF URL
    const exportTask = last?.data?.tasks?.find(
      (t) => t.name === "export" && t.status === "finished"
    );
    const fileUrl = exportTask?.result?.files?.[0]?.url;
    if (!fileUrl) throw new Error("CloudConvert: missing export file url");

    const pdfResp = await fetch(fileUrl);
    if (!pdfResp.ok) {
      throw new Error(`Failed to download PDF (${pdfResp.status})`);
    }
    const pdfBuf = Buffer.from(await pdfResp.arrayBuffer());

    // Stream PDF back to the user
    res.setHeader("Content-Type", "application/pdf");
    // Optional: force download with a nice filename
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="CommonCarryDeclaration.pdf"`
    );
    return res.status(200).send(pdfBuf);
  } catch (e) {
    // Classify common CloudConvert issues
    console.error("CloudConvert path failed:", e.message);
    // 402 => credits; 422 => plan/input restrictions
    // Always fall back to DOCX for your users:
    return sendDocxFallback(res, docxBuffer);
  }
}

// ---- fallback: send the generated DOCX so users still get a file ----
function sendDocxFallback(res, docxBuffer) {
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="CommonCarryDeclaration.docx"`
  );
  return res.status(200).send(docxBuffer);
}
