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
    // Extract data from the form submission
    const { fullName, witness1Name, witness1Email, witness2Name, witness2Email } = req.body;

    // Load the Common Carry Declaration template
    const templatePath = path.join(process.cwd(), "templates", "CommonCarryDeclaration.docx");
    const content = fs.readFileSync(templatePath, "binary");

    // Initialize docx templating engine
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

    // Render variables into the document
    doc.render({
      FULL_NAME: fullName,
      WITNESS_1_NAME: witness1Name,
      WITNESS_1_EMAIL: witness1Email,
      WITNESS_2_NAME: witness2Name,
      WITNESS_2_EMAIL: witness2Email,
    });

    // Create output directory if it doesn’t exist
    const tempDir = path.join(process.cwd(), "output");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    // Generate safe file name
    const safeName = (fullName || "Declaration").replace(/[^\w\s-]/g, "_");

    // Save rendered DOCX file
    const inputFilePath = path.join(tempDir, `${safeName}.docx`);
    fs.writeFileSync(inputFilePath, doc.getZip().generate({ type: "nodebuffer" }));

    // -------------------------------------------------------------
    // 🧩 Attempt PDF conversion via CloudConvert
    // -------------------------------------------------------------
    try {
      const job = await cloudConvert.jobs.create({
        tasks: {
          import: { operation: "import/upload" },
          convert: { operation: "convert", input: "import", output_format: "pdf" },
          export: { operation: "export/url", input: "convert" },
        },
      });

      // Upload DOCX to CloudConvert
      const uploadTask = job.tasks.find(t => t.name === "import");
      await cloudConvert.tasks.upload(uploadTask, fs.createReadStream(inputFilePath));

      // Wait for job to finish
      const updatedJob = await cloudConvert.jobs.wait(job.id);
      const exportTask = updatedJob.tasks.find(t => t.name === "export");
      const file = exportTask.result.files[0];

      // Fetch the converted PDF
      const response = await fetch(file.url);
      const pdfBuffer = Buffer.from(await response.arrayBuffer());

      // Send the PDF to the user
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}.pdf"`);
      return res.send(pdfBuffer);

    } catch (err) {
      // Fallback to DOCX if CloudConvert fails
      console.error("❌ CloudConvert failed — sending DOCX fallback:", err.message);
      const buffer = doc.getZip().generate({ type: "nodebuffer" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}.docx"`);
      return res.send(buffer);
    }

  } catch (err) {
    console.error("❌ Fatal error in generate-pdf.js:", err);
    return res.status(500).json({ error: err.message || "Unexpected server error" });
  }
}
