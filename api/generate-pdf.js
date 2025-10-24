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

    // Load DOCX template
    const templatePath = path.join(process.cwd(), "templates", "CommonCarryDeclaration.docx");
    const content = fs.readFileSync(templatePath, "binary");

    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

    // Render placeholders
    doc.render({
      FULL_NAME: fullName,
      WITNESS_1_NAME: witness1Name,
      WITNESS_1_EMAIL: witness1Email,
      WITNESS_2_NAME: witness2Name,
      WITNESS_2_EMAIL: witness2Email,
    });

    // Create the personalized .docx
    const buffer = doc.getZip().generate({ type: "nodebuffer" });
    const tempDocxPath = path.join("/tmp", `${fullName.replace(/\s+/g, "_")}_Declaration.docx`);
    fs.writeFileSync(tempDocxPath, buffer);

    // ✅ Upload DOCX to CloudConvert and convert to PDF
    const job = await cloudConvert.jobs.create({
      tasks: {
        import_file: { operation: "import/upload" },
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

    const uploadTask = job.tasks.filter(task => task.name === "import_file")[0];
    const uploadUrl = uploadTask.result.form.url;

    // Upload DOCX to CloudConvert
    const fileStream = fs.createReadStream(tempDocxPath);
    await cloudConvert.tasks.upload(uploadTask, fileStream);

    // Wait for job completion
    const completedJob = await cloudConvert.jobs.wait(job.id);
    const exportTask = completedJob.tasks.filter(task => task.operation === "export/url")[0];
    const pdfUrl = exportTask.result.files[0].url;

    // Return PDF URL
    return res.status(200).json({ pdfUrl });
  } catch (error) {
    console.error("PDF generation error:", error);
    return res.status(500).json({ error: error.message || "PDF generation failed" });
  }
}
