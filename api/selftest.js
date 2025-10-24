import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import CloudConvert from "cloudconvert";

export default async function handler(req, res) {
  const report = {
    template: "❌ Not checked",
    docRender: "❌ Not checked",
    cloudConvertKey: "❌ Not checked",
    pdfConversion: "❌ Not checked",
  };

  try {
    // --- 1️⃣ Check template file ---
    const templatePath = path.join(process.cwd(), "templates", "CommonCarryDeclaration.docx");
    if (fs.existsSync(templatePath)) {
      report.template = "✅ Template file found";
    } else {
      report.template = "❌ Template missing";
      return res.status(500).json(report);
    }

    // --- 2️⃣ Check DOCX rendering ---
    const content = fs.readFileSync(templatePath, "binary");
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

    try {
      doc.render({
        FULL_NAME: "Test User",
        WITNESS_1_NAME: "Witness One",
        WITNESS_1_EMAIL: "one@example.com",
        WITNESS_2_NAME: "Witness Two",
        WITNESS_2_EMAIL: "two@example.com",
      });
      report.docRender = "✅ DOCX template rendering successful";
    } catch (err) {
      report.docRender = `❌ DOCX render failed: ${err.message}`;
      return res.status(500).json(report);
    }

    // --- 3️⃣ Check CloudConvert API Key ---
    const apiKey = process.env.CLOUDCONVERT_API_KEY;
    if (!apiKey) {
      report.cloudConvertKey = "❌ No CloudConvert API key detected";
      return res.status(500).json(report);
    }
    const cloudConvert = new CloudConvert(apiKey);
    report.cloudConvertKey = "✅ CloudConvert API key detected";

    // --- 4️⃣ Attempt a test conversion ---
    try {
      const tempDir = path.join(process.cwd(), "output");
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
      const testPath = path.join(tempDir, "test.docx");
      fs.writeFileSync(testPath, doc.getZip().generate({ type: "nodebuffer" }));

      const job = await cloudConvert.jobs.create({
        tasks: {
          import: { operation: "import/upload" },
          convert: { operation: "convert", input: "import", output_format: "pdf" },
          export: { operation: "export/url", input: "convert" },
        },
      });

      const uploadTask = job.tasks.find(t => t.name === "import");
      await cloudConvert.tasks.upload(uploadTask, fs.createReadStream(testPath));
      await cloudConvert.jobs.wait(job.id);

      report.pdfConversion = "✅ CloudConvert PDF conversion successful";
    } catch (err) {
      report.pdfConversion = `❌ CloudConvert conversion failed: ${err.message}`;
    }

    return res.status(200).json(report);
  } catch (err) {
    report.final = `❌ Unhandled fatal error: ${err.message}`;
    return res.status(500).json(report);
  }
}
