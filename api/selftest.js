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
    // 1️⃣ Template check
    const templatePath = path.join(process.cwd(), "templates", "CommonCarryDeclaration.docx");
    if (!fs.existsSync(templatePath)) {
      report.template = "❌ Template missing";
      return res.status(500).json(report);
    }
    report.template = "✅ Template file found";

    // 2️⃣ DOCX rendering check
    const content = fs.readFileSync(templatePath, "binary");
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
    doc.render({
      FULL_NAME: "Test User",
      WITNESS_1_NAME: "Witness One",
      WITNESS_1_EMAIL: "one@example.com",
      WITNESS_2_NAME: "Witness Two",
      WITNESS_2_EMAIL: "two@example.com",
    });
    report.docRender = "✅ DOCX template rendering successful";

    // 3️⃣ CloudConvert key check
    const apiKey = process.env.CLOUDCONVERT_API_KEY;
    if (!apiKey) {
      report.cloudConvertKey = "❌ No CloudConvert API key detected";
      return res.status(500).json(report);
    }
    const cloudConvert = new CloudConvert(apiKey);
    report.cloudConvertKey = "✅ CloudConvert API key detected";

    // 4️⃣ Attempt CloudConvert job (using buffer instead of file)
    try {
      const buffer = doc.getZip().generate({ type: "nodebuffer" });

      const job = await cloudConvert.jobs.create({
        tasks: {
          importBuffer: { operation: "import/base64", file: buffer.toString("base64") },
          convert: { operation: "convert", input: "importBuffer", output_format: "pdf" },
          export: { operation: "export/url", input: "convert" },
        },
      });

      await cloudConvert.jobs.wait(job.id);
      const exportTask = job.tasks.find(t => t.operation === "export/url");
      const fileUrl = exportTask.result?.files?.[0]?.url;

      report.pdfConversion = fileUrl
        ? "✅ CloudConvert PDF conversion successful"
        : "⚠️ Conversion job ran but file URL missing";
    } catch (err) {
      report.pdfConversion = `❌ CloudConvert conversion failed: ${err.message}`;
    }

    return res.status(200).json(report);
  } catch (err) {
    report.final = `❌ Fatal: ${err.message}`;
    return res.status(500).json(report);
  }
}
