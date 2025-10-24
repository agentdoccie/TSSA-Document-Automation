import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import CloudConvert from "cloudconvert";

const cloudConvert = new CloudConvert(process.env.CLOUDCONVERT_API_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { fullName, witness1Name, witness1Email, witness2Name, witness2Email } = req.body;

    // Load DOCX template (placed in /templates/CommonCarryDeclaration.docx)
    const templatePath = path.join(process.cwd(), "templates", "CommonCarryDeclaration.docx");
    const content = fs.readFileSync(templatePath, "binary");

    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

    // Replace placeholders with submitted values
    doc.render({
      FULL_NAME: fullName,
      WITNESS_1_NAME: witness1Name,
      WITNESS_1_EMAIL: witness1Email,
      WITNESS_2_NAME: witness2Name,
      WITNESS_2_EMAIL: witness2Email,
      SIGNATURE_DATE: new Date().toLocaleDateString(),
    });

    // Generate DOCX buffer
    const buffer = doc.getZip().generate({ type: "nodebuffer" });

    // Save DOCX temporarily for conversion
    const tempDocx = "/tmp/CommonCarryDeclaration.docx";
    fs.writeFileSync(tempDocx, buffer);

    // 🔹 Upload to CloudConvert for DOCX → PDF
    const job = await cloudConvert.jobs.create({
      tasks: {
        import_file: {
          operation: "import/upload",
        },
        convert: {
          operation: "convert",
          input: "import_file",
          input_format: "docx",
          output_format: "pdf",
        },
        export_file: {
          operation: "export/url",
          input: "convert",
        },
      },
    });

    const uploadTask = job.tasks.find(task => task.name === "import_file");
    const uploadUrl = uploadTask.result.form.url;

    // Upload file to CloudConvert
    await cloudConvert.tasks.upload(uploadUrl, fs.createReadStream(tempDocx));

    // Wait for job to finish
    const finishedJob = await cloudConvert.jobs.wait(job.id);
    const exportTask = finishedJob.tasks.find(task => task.operation === "export/url");
    const pdfUrl = exportTask.result.files[0].url;

    // ✅ Return PDF URL
    res.status(200).json({ pdfUrl });
  } catch (error) {
    console.error("❌ PDF generation error:", error);
    res.status(500).json({ error: "Failed to generate PDF" });
  }
}
