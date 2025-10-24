import fs from "fs";
import path from "path";
import { promisify } from "util";
import CloudConvert from "cloudconvert";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

// Initialize CloudConvert client
const cloudConvert = new CloudConvert(process.env.CLOUDCONVERT_API_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  // Collect and normalize input
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
    fullName: fullName || FULL_NAME || "[FIELD MISSING: fullName]",
    witness1Name: witness1Name || WITNESS_1_NAME || "[FIELD MISSING: witness1Name]",
    witness1Email: witness1Email || WITNESS_1_EMAIL || "[FIELD MISSING: witness1Email]",
    witness2Name: witness2Name || WITNESS_2_NAME || "[FIELD MISSING: witness2Name]",
    witness2Email: witness2Email || WITNESS_2_EMAIL || "[FIELD MISSING: witness2Email]",
    signatureDate: new Date().toLocaleDateString(),
  };

  try {
    // Step 1: Load DOCX template
    const templatePath = path.join(process.cwd(), "templates", "CommonCarryDeclaration.docx");

    if (!fs.existsSync(templatePath)) {
      throw new Error("Template not found on server");
    }

    const content = await readFile(templatePath, "binary");
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

    // Step 2: Render safely (no crash on missing placeholders)
    let missingFields = [];
    try {
      doc.render(data);
    } catch (error) {
      console.warn("⚠️ Template rendering warning:", error.message);

      if (error.properties?.errors) {
        missingFields = error.properties.errors.map(e => e.properties.explanation);
        console.warn("⚠️ Missing placeholders:", missingFields);
      }

      // Insert markers for missing fields so document still makes sense
      Object.keys(data).forEach(k => {
        if (data[k].includes("[FIELD MISSING")) {
          console.warn(`Added placeholder for missing field: ${k}`);
        }
      });
    }

    const outputPath = path.join(process.cwd(), "temp", "GeneratedDocument.docx");
    const nodebuf = doc.getZip().generate({ type: "nodebuffer" });
    await writeFile(outputPath, nodebuf);

    // Step 3: Try CloudConvert (DOCX -> PDF)
    try {
      const job = await cloudConvert.jobs.create({
        tasks: {
          importBuffer: { operation: "import/upload" },
          convert: {
            operation: "convert",
            input: "importBuffer",
            input_format: "docx",
            output_format: "pdf",
          },
          exportFile: { operation: "export/url", input: "convert" },
        },
      });

      const uploadTask = job.tasks.find(t => t.name === "importBuffer");
      await cloudConvert.tasks.upload(uploadTask, nodebuf);

      const updatedJob = await cloudConvert.jobs.wait(job.id);
      const exportTask = updatedJob.tasks.find(t => t.operation === "export/url");
      const fileUrl = exportTask.result.files[0].url;

      return res.status(200).json({
        ok: true,
        message: missingFields.length
          ? "✅ PDF generated with missing field warnings"
          : "✅ PDF generated successfully",
        fileUrl,
        missingFields,
        fallback: "pdf",
      });

    } catch (pdfError) {
      console.error("❌ PDF conversion failed, falling back to DOCX output:", pdfError);

      // Step 4: Return DOCX fallback path
      return res.status(200).json({
        ok: true,
        message: "⚠️ PDF conversion failed — DOCX file generated instead",
        fallback: "docx-only",
        missingFields,
      });
    }

  } catch (error) {
    console.error("❌ Document generation error:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
