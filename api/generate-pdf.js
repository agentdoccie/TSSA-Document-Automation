// ✅ TSSA — Generate PDF from DOCX template (fixed and clean version)
import fs from "fs/promises";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import CloudConvert from "cloudconvert";

export const config = { runtime: "nodejs" };

// Get your API key from environment
const cloudconvertApiKey = process.env.CLOUDCONVERT_API_KEY;
const cloudconvert = new CloudConvert(cloudconvertApiKey);

// Helper: read body of POST request
async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // Parse incoming data
    const body = await readJsonBody(req);
    const { fullName, witness1Name, witness1Email, witness2Name, witness2Email } = body;

    // 1️⃣ Load DOCX template
    const templatePath = path.join(process.cwd(), "templates", "CommonCarryDeclaration.docx");
    const content = await fs.readFile(templatePath, "binary");

    // 2️⃣ Fill placeholders using Docxtemplater
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

    doc.render({
      FULL_NAME: fullName || "",
      WITNESS_1_NAME: witness1Name || "",
      WITNESS_1_EMAIL: witness1Email || "",
      WITNESS_2_NAME: witness2Name || "",
      WITNESS_2_EMAIL: witness2Email || "",
      SIGNATURE_DATE: new Date().toLocaleDateString("en-US")
    });

    const filledBuffer = doc.getZip().generate({ type: "nodebuffer" });

    // 3️⃣ Upload to CloudConvert and convert DOCX → PDF
    const job = await cloudconvert.jobs.create({
      tasks: {
        import_myfile: {
          operation: "import/base64",
          file: filledBuffer.toString("base64"),
          filename: "CommonCarryDeclaration.docx"
        },
        convert_myfile: {
          operation: "convert",
          input: ["import_myfile"],
          input_format: "docx",
          output_format: "pdf"
        },
        export_myfile: {
          operation: "export/url",
          input: ["convert_myfile"]
        }
      }
    });

    const jobResult = await cloudconvert.jobs.wait(job.id);
    const fileUrl = jobResult.tasks.find(t => t.name === "export_myfile").result.files[0].url;

    // 4️⃣ Return URL to client
    res.status(200).json({ success: true, pdfUrl: fileUrl });

  } catch (error) {
    console.error("Full error:", error);
    res.status(500).json({
      error: error.message || "Unknown error",
      stack: error.stack || null,
    });
  }
}
