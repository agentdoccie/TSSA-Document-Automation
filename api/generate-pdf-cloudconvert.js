import fs from "fs";
import path from "path";
import { promisify } from "util";
import CloudConvert from "cloudconvert";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

const readFile = promisify(fs.readFile);

// Initialize CloudConvert client
const cloudConvert = new CloudConvert(process.env.CLOUDCONVERT_API_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    // --- Step 1: Normalize and safely collect input fields ---
    const {
      fullName,
      witness1Name,
      witness1Email,
      witness2Name,
      witness2Email,
      FULL_NAME,
      WITNESS_1_NAME,
      WITNESS_1_EMAIL,
      WITNESS_2_NAME,
      WITNESS_2_EMAIL,
    } = req.body;

    const data = {
      fullName: fullName || FULL_NAME || "",
      witness1Name: witness1Name || WITNESS_1_NAME || "",
      witness1Email: witness1Email || WITNESS_1_EMAIL || "",
      witness2Name: witness2Name || WITNESS_2_NAME || "",
      witness2Email: witness2Email || WITNESS_2_EMAIL || "",
      signatureDate: new Date().toLocaleDateString(),
    };

    // --- Step 2: Load DOCX template ---
    const templatePath = path.join(process.cwd(), "templates", "CommonCarryDeclaration.docx");

    if (!fs.existsSync(templatePath)) {
      throw new Error("Template not found on server");
    }

    const content = await readFile(templatePath, "binary");
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

    // --- Step 3: Safe render mode ---
    let missingFields = [];
    try {
      doc.render(data);
    } catch (error) {
      console.warn("⚠️ Template rendering warning:", error.message);

      if (error.properties && error.properties.errors) {
        missingFields = error.properties.errors.map(e => e.properties.explanation);
        console.warn("⚠️ Missing or extra placeholders:", missingFields);
      }
    }

    const nodebuf = doc.getZip().generate({ type: "nodebuffer" });

    // --- Step 4: Send DOCX to CloudConvert to convert to PDF ---
    const job = await cloudConvert.jobs.create({
      tasks: {
        importBuffer: {
          operation: "import/upload",
        },
        convert: {
          operation: "convert",
          input: "importBuffer",
          input_format: "docx",
          output_format: "pdf",
        },
        exportFile: {
          operation: "export/url",
          input: "convert",
        },
      },
    });

    const uploadTask = job.tasks.find(task => task.name === "importBuffer");
    await cloudConvert.tasks.upload(uploadTask, nodebuf);

    // --- Step 5: Wait for conversion result ---
    const updatedJob = await cloudConvert.jobs.wait(job.id);
    const exportTask = updatedJob.tasks.find(task => task.operation === "export/url");

    const fileUrl = exportTask.result.files[0].url;

    // --- Step 6: Respond to frontend ---
    return res.status(200).json({
      ok: true,
      message: missingFields.length
        ? "✅ PDF generated with some missing fields"
        : "✅ PDF generated successfully",
      missingFields,
      fileUrl,
    });
  } catch (error) {
    console.error("❌ DOCX→PDF Error:", error);
    return res.status(500).json({ ok: false, error: error.message || "Failed to generate PDF" });
  }
}
