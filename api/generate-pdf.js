// /api/generate-pdf.js
import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import fetch from "node-fetch";
import FormData from "form-data";

// Safety: small helper
const has = (v) => typeof v === "string" && v.trim().length > 0;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  // 1) Gather input (trim to avoid whitespace mismatches)
  const fullName       = String(req.body.fullName || "").trim();
  const witness1Name   = String(req.body.witness1Name || "").trim();
  const witness1Email  = String(req.body.witness1Email || "").trim();
  const witness2Name   = String(req.body.witness2Name || "").trim();
  const witness2Email  = String(req.body.witness2Email || "").trim();

  // 2) Resolve template
  const templatePath = path.join(process.cwd(), "templates", "CommonCarryDeclaration.docx");
  if (!fs.existsSync(templatePath)) {
    return res.status(500).json({
      ok: false,
      error: "Template not found on server",
      hint: "/templates/CommonCarryDeclaration.docx",
    });
  }

  let nodebuf;
  try {
    const content = fs.readFileSync(templatePath, "binary");
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

    // 3) Render placeholders — keys MUST match the template exactly
    doc.render({
      FULL_NAME:        fullName,
      WITNESS_1_NAME:   witness1Name,
      WITNESS_1_EMAIL:  witness1Email,
      WITNESS_2_NAME:   witness2Name,
      WITNESS_2_EMAIL:  witness2Email,
      SIGNATURE_DATE:   new Date().toLocaleDateString(),
    });

    nodebuf = doc.getZip().generate({ type: "nodebuffer" });
  } catch (e) {
    // Docxtemplater gives precise errors when a tag is missing/invalid
    console.error("DOCX render failed:", e);
    return res.status(500).json({
      ok: false,
      error: "DOCX render failed",
      detail: sanitizeDocxError(e),
      hint: "Ensure your .docx placeholders exactly match: FULL_NAME, WITNESS_1_NAME, WITNESS_1_EMAIL, WITNESS_2_NAME, WITNESS_2_EMAIL, SIGNATURE_DATE.",
    });
  }

  // 4) Try CloudConvert to get a PDF; if anything goes wrong, fall back to DOCX
  const ccKey = process.env.CLOUDCONVERT_API_KEY || "";
  const safeName = `CommonCarryDeclaration`;

  if (has(ccKey)) {
    try {
      // Create job: import/upload → convert(pdf) → export/url
      const createR = await fetch("https://api.cloudconvert.com/v2/jobs", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ccKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tasks: {
            import:  { operation: "import/upload" },
            convert: { operation: "convert", input: "import", output_format: "pdf" },
            export:  { operation: "export/url", input: "convert" },
          },
        }),
      });
      const job = await createR.json();
      if (!createR.ok) throw new Error(`job create ${createR.status} ${JSON.stringify(job)}`);

      const uploadTask = job?.data?.tasks?.find(t => t.name === "import");
      if (!uploadTask?.result?.form?.url) throw new Error("no upload form");

      // Build multipart with returned fields
      const form = new FormData();
      Object.entries(uploadTask.result.form.parameters || {}).forEach(([k, v]) => form.append(k, v));
      form.append("file", nodebuf, { filename: "doc.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });

      const up = await fetch(uploadTask.result.form.url, { method: "POST", body: form });
      if (!up.ok) throw new Error(`upload ${up.status}`);

      // Poll until finished
      const jobId = job.data.id;
      let done = false, tries = 0;
      while (!done && tries < 40) {
        await sleep(1500);
        const jr = await fetch(`https://api.cloudconvert.com/v2/jobs/${jobId}`, {
          headers: { Authorization: `Bearer ${ccKey}` },
        });
        const jj = await jr.json();
        const st = jj?.data?.status;
        if (st === "finished") { done = true; break; }
        if (st === "error") throw new Error(`cloudconvert error: ${JSON.stringify(jj?.data)}`);
        tries++;
      }
      if (!done) throw new Error("cloudconvert timeout");

      // Grab exported file
      const exportTask = (await fetch(`https://api.cloudconvert.com/v2/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${ccKey}` },
      }).then(r => r.json()))?.data?.tasks?.find(t => t.operation === "export/url");

      const fileUrl = exportTask?.result?.files?.[0]?.url;
      if (!fileUrl) throw new Error("no export url");

      const pdfResp = await fetch(fileUrl);
      const pdfBuffer = Buffer.from(await pdfResp.arrayBuffer());

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}.pdf"`);
      return res.send(pdfBuffer);
    } catch (err) {
      console.error("CloudConvert failed — falling back to DOCX:", err.message);
      // continue to DOCX fallback
    }
  }

  // 5) Fallback: return the rendered DOCX so the user still gets a document
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}.docx"`);
  return res.send(nodebuf);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Docxtemplater error payloads are objects; strip huge buffers
function sanitizeDocxError(e) {
  const out = { message: e?.message || String(e) };
  if (e?.properties?.errors) {
    out.properties = {
      errors: e.properties.errors.map((er) => ({
        id: er.id, // e.g. "rawTag" / "nonclosingtag" / "scopeparser"
        explanation: er.explanation,
        tag: er.properties?.tag,
        file: er.properties?.file,
      })),
    };
  }
  return out;
}
