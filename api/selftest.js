// /api/selftest.js
import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

// ---------- helpers ----------
const has = (v) => typeof v === "string" && v.trim().length > 0;

async function sendAlertEmail({ subject, text, html }) {
  const to = process.env.ALERT_EMAIL || "nick@payitforward.africa";
  const from = process.env.ALERT_FROM || "TSSA Monitor <no-reply@yourdomain.tld>";

  // Try Resend first
  if (has(process.env.RESEND_API_KEY)) {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to, subject, html: html || `<pre>${text}</pre>`, text }),
      });
      if (!r.ok) throw new Error(`Resend ${r.status}`);
      return;
    } catch (e) {
      console.error("Resend failed:", e.message);
    }
  }

  // Fallback to SendGrid
  if (has(process.env.SENDGRID_API_KEY)) {
    try {
      const r = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.SENDGRID_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: (from.match(/<(.+?)>/) || [])[1] || "no-reply@yourdomain.tld", name: "TSSA Monitor" },
          subject,
          content: [{ type: "text/html", value: html || `<pre>${text}</pre>` }],
        }),
      });
      if (!r.ok) throw new Error(`SendGrid ${r.status}`);
      return;
    } catch (e) {
      console.error("SendGrid failed:", e.message);
    }
  }

  console.warn("No email provider configured; alert not sent.");
}

function fmtReport(r) {
  return `
TSSA Document Automation — Selftest Report
Time (UTC): ${new Date().toISOString()}

Template:  ${r.template}
Doc Render: ${r.docRender}
CloudConvert Key: ${r.cloudConvertKey}
PDF Conversion: ${r.pdfConversion}
Credit Balance: ${r.creditBalance}

Notes:
${(r.notes || []).map(x => ` - ${x}`).join("\n")}
  `.trim();
}

// ---------- API handler ----------
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const report = {
    template: "❓",
    docRender: "❓",
    cloudConvertKey: "❓",
    pdfConversion: "❓",
    creditBalance: "❓",
    notes: [],
    final: "❓",
  };

  try {
    // 1) Template exists
    const templatePath = path.join(process.cwd(), "templates", "CommonCarryDeclaration.docx");
    if (!fs.existsSync(templatePath)) {
      report.template = "❌ Template file missing";
      report.notes.push("Place /templates/CommonCarryDeclaration.docx in repo.");
    } else {
      report.template = "✅ Template file found.";
    }

    // 2) Render DOCX in memory
    if (report.template.startsWith("✅")) {
      try {
        const content = fs.readFileSync(templatePath, "binary");
        const zip = new PizZip(content);
        const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
        doc.render({
          FULL_NAME: "Selftest User",
          WITNESS_1_NAME: "Alice",
          WITNESS_1_EMAIL: "alice@example.com",
          WITNESS_2_NAME: "Bob",
          WITNESS_2_EMAIL: "bob@example.com",
        });
        // ensure we can generate a buffer without writing to disk
        doc.getZip().generate({ type: "nodebuffer" });
        report.docRender = "✅ DOCX template rendering successful";
      } catch (e) {
        report.docRender = `❌ DOCX render failed: ${e.message}`;
      }
    }

    // 3) CloudConvert availability + credits
    const ccKey = process.env.CLOUDCONVERT_API_KEY || "";
    report.cloudConvertKey = has(ccKey)
      ? "✅ CloudConvert API key detected"
      : "❌ Missing CLOUDCONVERT_API_KEY";

    // Credits (if key present)
    if (has(ccKey)) {
      try {
        const r = await fetch("https://api.cloudconvert.com/v2/credits", {
          headers: { Authorization: `Bearer ${ccKey}` }
        });
        const j = await r.json();
        if (r.ok && j?.data?.credits != null) {
          report.creditBalance = `💰 Remaining CloudConvert credits: ${j.data.credits}`;
          if (j.data.credits <= 50) {
            report.notes.push("Low CloudConvert credits — consider topping up soon.");
          }
        } else {
          report.creditBalance = `⚠️ Could not fetch credits (${r.status})`;
        }
      } catch (e) {
        report.creditBalance = `⚠️ Could not fetch credits: ${e.message}`;
      }
    } else {
      report.creditBalance = "⚠️ No API key";
    }

    // 4) Attempt a tiny PDF conversion (only if key & template good & render good)
    if (
      report.template.startsWith("✅") &&
      report.docRender.startsWith("✅") &&
      has(ccKey)
    ) {
      try {
        // create a minimal doc buffer again for conversion
        const content = fs.readFileSync(templatePath, "binary");
        const zip = new PizZip(content);
        const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
        doc.render({
          FULL_NAME: "Selftest User",
          WITNESS_1_NAME: "Alice",
          WITNESS_1_EMAIL: "alice@example.com",
          WITNESS_2_NAME: "Bob",
          WITNESS_2_EMAIL: "bob@example.com",
        });
        const nodebuf = doc.getZip().generate({ type: "nodebuffer" });

        // Prepare multipart upload (no disk write)
        const form = new FormData();
        form.append("file", new Blob([nodebuf], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), "selftest.docx");

        // job: import/upload -> convert -> export/url
        const ccreate = await fetch("https://api.cloudconvert.com/v2/jobs", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ccKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tasks: {
              import: { operation: "import/upload" },
              convert: { operation: "convert", input: "import", output_format: "pdf" },
              export: { operation: "export/url", input: "convert" }
            }
          })
        });
        const job = await ccreate.json();
        if (!ccreate.ok) throw new Error(`CloudConvert job create failed (${ccreate.status}) ${JSON.stringify(job)}`);

        // upload file
        const uploadTask = job.data.tasks.find(t => t.name === "import");
        const upload = await fetch(uploadTask.result.form.url, {
          method: "POST",
          body: (() => {
            const f = new FormData();
            // append fields returned by import/upload
            Object.entries(uploadTask.result.form.parameters || {}).forEach(([k, v]) => f.append(k, v));
            f.append("file", new Blob([nodebuf], { type: "application/octet-stream" }), "selftest.docx");
            return f;
          })(),
        });
        if (!upload.ok) throw new Error(`CloudConvert upload failed (${upload.status})`);

        // wait until finished
        const jobId = job.data.id;
        // small poll
        let done = false, tries = 0;
        while (!done && tries < 20) {
          await new Promise(r => setTimeout(r, 1500));
          const jr = await fetch(`https://api.cloudconvert.com/v2/jobs/${jobId}`, {
            headers: { Authorization: `Bearer ${ccKey}` }
          });
          const jj = await jr.json();
          const st = jj?.data?.status;
          if (st === "finished") { done = true; break; }
          if (st === "error") throw new Error(`CloudConvert reported error: ${JSON.stringify(jj?.data)}`);
          tries++;
        }
        if (!done) throw new Error("CloudConvert timeout");

        report.pdfConversion = "✅ CloudConvert PDF conversion reachable (selftest)";
      } catch (e) {
        // classify common statuses
        if (/402/.test(e.message)) {
          report.pdfConversion = "❌ CloudConvert test failed: 402 (no credits)";
          report.notes.push("Add credits to CloudConvert or rely on local PDF fallback.");
        } else if (/422/.test(e.message)) {
          report.pdfConversion = "❌ CloudConvert test failed: 422 (bad input or plan restriction)";
        } else {
          report.pdfConversion = `❌ CloudConvert test failed: ${e.message}`;
        }
      }
    } else {
      report.pdfConversion = "⚠️ Skipped (missing key or template/render failed)";
    }

    report.final = "✅ Selftest complete.";

    // Email on any red condition
    const needsAlert =
      /❌/.test(report.template) ||
      /❌/.test(report.docRender) ||
      /❌/.test(report.cloudConvertKey) ||
      /❌/.test(report.pdfConversion);

    if (needsAlert) {
      const subject = "🚨 TSSA Selftest Alert";
      const text = fmtReport(report);
      await sendAlertEmail({ subject, text });
    }

    return res.status(200).json(report);
  } catch (err) {
    const msg = `Unhandled fatal error: ${err.message}`;
    console.error(msg);
    const subject = "🚨 TSSA Selftest Crash";
    await sendAlertEmail({ subject, text: msg });
    return res.status(500).json({ error: msg });
  }
}
