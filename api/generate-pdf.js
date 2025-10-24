// /api/generate-pdf.js
import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import CloudConvert from "cloudconvert";
import fetch from "node-fetch";
import FormData from "form-data";

const cloudConvert = new CloudConvert(process.env.CLOUDCONVERT_API_KEY);

function safeName(s) {
  return String(s || "document").replace(/[^a-z0-9._-]+/gi, "_").slice(0, 80);
}

// helpful logging for docxtemplater errors
function explainDocxError(err) {
  if (!err || !err.properties) return err?.message || String(err);
  const lines = [];
  if (err.properties.explanation) lines.push(err.properties.explanation);
  if (Array.isArray(err.properties.errors)) {
    err.properties.errors.forEach((e, i) => {
      if (e.explanation) lines.push(`[${i}] ${e.explanation}`);
      if (e.properties && e.properties.id) lines.push(`   id: ${e.properties.id}`);
      if (e.properties && e.properties.expression) lines.push(`   expr: ${e.properties.expression}`);
    });
  }
  return lines.join("\n") || err.message;
}

// tiny helper to render our HTML template with plain {{TAG}} replacements
function renderHtmlTemplate(html, data) {
  return html.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, k) => {
    const v = data[k];
    return v == null ? "" : String(v);
  });
}

// uploads a Buffer to CloudConvert import/upload task
async function cloudconvertUploadFromBuffer(jobData, filename, buffer) {
  const uploadTask = jobData.data.tasks.find(t => t.name === "import");
  const form = new FormData();
  const params = uploadTask.result.form.parameters || {};
  Object.entries(params).forEach(([k, v]) => form.append(k, v));
  form.append("file", buffer, { filename });
  const r = await fetch(uploadTask.result.form.url, {
    method: "POST",
    body: form,
  });
  if (!r.ok) throw new Error(`CloudConvert upload failed (${r.status})`);
}

async function runCloudconvert(buffer, sourceExt, outNameBase) {
  const jobCreate = await fetch("https://api.cloudconvert.com/v2/jobs", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.CLOUDCONVERT_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tasks: {
        import: { operation: "import/upload" },
        convert: { operation: "convert", input: "import", output_format: "pdf" },
        export: { operation: "export/url", input: "convert" },
      },
    }),
  });
  const job = await jobCreate.json();
  if (!jobCreate.ok) throw new Error(`CloudConvert job create failed (${jobCreate.status}) ${JSON.stringify(job)}`);

  // Upload the source file (DOCX or HTML)
  await cloudconvertUploadFromBuffer(job, `${outNameBase}.${sourceExt}`, buffer);

  // wait for completion
  const jobId = job.data.id;
  let tries = 0;
  for (;;) {
    await new Promise(r => setTimeout(r, 1500));
    const st = await fetch(`https://api.cloudconvert.com/v2/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${process.env.CLOUDCONVERT_API_KEY}` }
    });
    const j = await st.json();
    const s = j?.data?.status;
    if (s === "finished") break;
    if (s === "error") throw new Error(`CloudConvert error: ${JSON.stringify(j?.data)}`);
    if (++tries > 30) throw new Error("CloudConvert timeout");
  }

  // grab the PDF URL and return the PDF buffer
  const finalJob = await fetch(`https://api.cloudconvert.com/v2/jobs/${jobId}`, {
    headers: { Authorization: `Bearer ${process.env.CLOUDCONVERT_API_KEY}` }
  });
  const finalData = await finalJob.json();
  const exportTask = finalData.data.tasks.find(t => t.name === "export");
  const file = exportTask.result.files[0];
  const pdfResp = await fetch(file.url);
  const pdfBuffer = Buffer.from(await pdfResp.arrayBuffer());
  return pdfBuffer;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  // 1) Collect and sanitize input
  const fullName       = String(req.body.fullName || "").trim();
  const witness1Name   = String(req.body.witness1Name || "").trim();
  const witness1Email  = String(req.body.witness1Email || "").trim();
  const witness2Name   = String(req.body.witness2Name || "").trim();
  const witness2Email  = String(req.body.witness2Email || "").trim();
  const data = {
    FULL_NAME: fullName,
    WITNESS_1_NAME: witness1Name,
    WITNESS_1_EMAIL: witness1Email,
    WITNESS_2_NAME: witness2Name,
    WITNESS_2_EMAIL: witness2Email,
    SIGNATURE_DATE: new Date().toLocaleDateString(),
  };
  const baseName = safeName(`${fullName || "CommonCarryDeclaration"}`);

  // 2) Try DOCX → PDF first
  const templatePath = path.join(process.cwd(), "templates", "CommonCarryDeclaration.docx");
  try {
    if (!fs.existsSync(templatePath)) throw new Error("Template not found on server");

    const content = fs.readFileSync(templatePath, "binary");
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

    doc.render(data); // <-- If DOCX is unhealthy, error will be thrown here

    // render DOCX to buffer (we still let CloudConvert make the final PDF)
    const docxBuffer = doc.getZip().generate({ type: "nodebuffer" });

    const pdf = await runCloudconvert(docxBuffer, "docx", baseName);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${baseName}.pdf"`);
    return res.send(pdf);
  } catch (err) {
    // 3) Log real cause and FALL BACK to HTML → PDF
    console.error("DOCX render failed:", explainDocxError(err));

    try {
      const htmlPath = path.join(process.cwd(), "templates", "CommonCarryDeclaration.html");
      if (!fs.existsSync(htmlPath)) throw new Error("HTML fallback template not found");
      const rawHtml = fs.readFileSync(htmlPath, "utf8");
      const filledHtml = renderHtmlTemplate(rawHtml, data);
      const htmlBuffer = Buffer.from(filledHtml, "utf8");

      const pdf = await runCloudconvert(htmlBuffer, "html", baseName);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${baseName}.pdf"`);
      return res.send(pdf);
    } catch (fallbackErr) {
      console.error("HTML fallback failed:", fallbackErr?.message || fallbackErr);
      return res.status(500).json({
        ok: false,
        error: "Failed to generate document",
        details: {
          docx: explainDocxError(err),
          html: String(fallbackErr?.message || fallbackErr),
        },
      });
    }
  }
}
