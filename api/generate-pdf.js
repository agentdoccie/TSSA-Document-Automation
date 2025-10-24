import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import fetch from "node-fetch";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib"; // <-- local fallback

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { FULL_NAME, WITNESS_1_NAME, WITNESS_1_EMAIL, WITNESS_2_NAME, WITNESS_2_EMAIL } = req.body;

    const templatePath = path.join(process.cwd(), "templates", "CommonCarryDeclaration.docx");
    if (!fs.existsSync(templatePath)) {
      return res.status(500).json({ error: "Template file missing" });
    }

    // Step 1: Generate the DOCX buffer
    const content = fs.readFileSync(templatePath, "binary");
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

    doc.render({
      FULL_NAME,
      WITNESS_1_NAME,
      WITNESS_1_EMAIL,
      WITNESS_2_NAME,
      WITNESS_2_EMAIL
    });

    const docBuffer = doc.getZip().generate({ type: "nodebuffer" });

    // Step 2: Try CloudConvert first
    const ccKey = process.env.CLOUDCONVERT_API_KEY;
    if (ccKey) {
      try {
        const formData = new FormData();
        formData.append(
          "file",
          new Blob([docBuffer], {
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          }),
          "document.docx"
        );

        const jobResponse = await fetch("https://api.cloudconvert.com/v2/jobs", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ccKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            tasks: {
              import: { operation: "import/upload" },
              convert: { operation: "convert", input: "import", output_format: "pdf" },
              export: { operation: "export/url", input: "convert" }
            }
          })
        });

        const job = await jobResponse.json();
        if (!jobResponse.ok) throw new Error(`CloudConvert job create failed (${jobResponse.status})`);

        const uploadTask = job.data.tasks.find(t => t.name === "import");
        const upload = await fetch(uploadTask.result.form.url, {
          method: "POST",
          body: (() => {
            const f = new FormData();
            Object.entries(uploadTask.result.form.parameters || {}).forEach(([k, v]) => f.append(k, v));
            f.append("file", new Blob([docBuffer]), "document.docx");
            return f;
          })()
        });

        if (!upload.ok) throw new Error(`CloudConvert upload failed (${upload.status})`);

        const jobId = job.data.id;
        let pdfUrl = null;
        for (let i = 0; i < 20; i++) {
          await new Promise(r => setTimeout(r, 1500));
          const jobStatus = await fetch(`https://api.cloudconvert.com/v2/jobs/${jobId}`, {
            headers: { Authorization: `Bearer ${ccKey}` }
          });
          const jj = await jobStatus.json();
          if (jj?.data?.status === "finished") {
            const exportTask = jj.data.tasks.find(t => t.name === "export");
            pdfUrl = exportTask?.result?.files?.[0]?.url;
            break;
          }
        }

        if (!pdfUrl) throw new Error("PDF export URL not found");

        const pdfFetch = await fetch(pdfUrl);
        const pdfBuffer = Buffer.from(await pdfFetch.arrayBuffer());

        // ✅ Return the PDF
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${FULL_NAME}_CommonCarryDeclaration.pdf"`);
        return res.send(pdfBuffer);
      } catch (err) {
        console.warn("⚠️ CloudConvert failed, falling back to local PDF:", err.message);
      }
    }

    // Step 3: Local fallback — generate a simple but valid PDF
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const { width, height } = page.getSize();
    const fontSize = 12;

    const drawText = (label, value, y) => {
      page.drawText(`${label}: ${value || ""}`, {
        x: 50,
        y,
        size: fontSize,
        font,
        color: rgb(0, 0, 0)
      });
    };

    drawText("Full Name", FULL_NAME, height - 100);
    drawText("Witness 1 Name", WITNESS_1_NAME, height - 130);
    drawText("Witness 1 Email", WITNESS_1_EMAIL, height - 150);
    drawText("Witness 2 Name", WITNESS_2_NAME, height - 180);
    drawText("Witness 2 Email", WITNESS_2_EMAIL, height - 200);
    drawText("Generated Locally", new Date().toISOString(), height - 250);

    const pdfBytes = await pdfDoc.save();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${FULL_NAME}_Fallback.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("Fatal error:", err.message);
    res.status(500).json({ error: "Failed to generate document", detail: err.message });
  }
}
