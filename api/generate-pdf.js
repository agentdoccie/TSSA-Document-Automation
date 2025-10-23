// ✅ TSSA — Generate PDF from DOCX with detailed CloudConvert logging
import fs from "fs/promises";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import CloudConvert from "cloudconvert";

export const config = { runtime: "nodejs" };

const cloudconvert = new CloudConvert(process.env.CLOUDCONVERT_API_KEY);

async function readJsonBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body = await readJsonBody(req);
    const { fullName, witness1Name, witness1Email, witness2Name, witness2Email } = body;

    // Load the template
    const templatePath = path.join(process.cwd(), "templates", "CommonCarryDeclaration.docx");
    const content = await fs.readFile(templatePath, "binary");
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

    doc.render({
      FULL_NAME: fullName,
      WITNESS_1_NAME: witness1Name,
      WITNESS_1_EMAIL: witness1Email,
      WITNESS_2_NAME: witness2Name,
      WITNESS_2_EMAIL: witness2Email,
      SIGNATURE_DATE: new Date().toLocaleDateString("en-US")
    });

    const filled = doc.getZip().generate({ type: "nodebuffer" });
    const fileBase64 = filled.toString("base64");

    // ✅ CloudConvert job
    const job = await cloudconvert.jobs.create({
      tasks: {
        importBase: {
          operation: "import/base64",
          file: fileBase64,
          filename: "CommonCarryDeclaration.docx"
        },
        convert: {
          operation: "convert",
          input: ["importBase"],
          input_format: "docx",
          output_format: "pdf"
        },
        exportResult: {
          operation: "export/url",
          input: ["convert"]
        }
      }
    });

    const result = await cloudconvert.jobs.wait(job.id);
    const exportTask = result.tasks.find(t => t.name === "exportResult");

    if (!exportTask || !exportTask.result?.files?.[0]) {
      console.error("CloudConvert error details:", result);
      throw new Error("Conversion failed — check API key or task structure");
    }

    const pdfUrl = exportTask.result.files[0].url;
    res.status(200).json({ success: true, pdfUrl });

  } catch (err) {
    console.error("💥 generate-pdf error:", err);
    res.status(500).json({
      message: err.message,
      stack: err.stack,
    });
  }
}
