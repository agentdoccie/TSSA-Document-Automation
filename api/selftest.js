import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import CloudConvert from "cloudconvert";

export default async function handler(req, res) {
  const report = {
    template: "❌ Template not found",
    docRender: "❌ DOCX template failed",
    cloudConvertKey: "❌ Not detected",
    pdfConversion: "⚠️ Skipped",
    creditBalance: "❌ Not checked",
    final: ""
  };

  try {
    // --- Check template ---
    const templatePath = path.join(process.cwd(), "templates", "CommonCarryDeclaration.docx");
    if (fs.existsSync(templatePath)) {
      report.template = "✅ Template file found.";

      const content = fs.readFileSync(templatePath, "binary");
      const zip = new PizZip(content);
      const doc = new Docxtemplater(zip);
      doc.render({
        FULL_NAME: "SelfTest User",
        WITNESS_1_NAME: "Alpha Tester",
        WITNESS_1_EMAIL: "alpha@example.com",
        WITNESS_2_NAME: "Beta Tester",
        WITNESS_2_EMAIL: "beta@example.com",
      });
      report.docRender = "✅ DOCX template rendering successful";
    }

    // --- Check CloudConvert key ---
    const apiKey = process.env.CLOUDCONVERT_API_KEY;
    if (!apiKey) {
      report.cloudConvertKey = "❌ No CloudConvert key found in environment";
      report.final = "⚠️ No CloudConvert key — using local PDF only.";
      return res.status(200).json(report);
    } else {
      report.cloudConvertKey = "✅ CloudConvert API key detected";
    }

    // --- Query credit balance ---
    try {
      const cloudConvert = new CloudConvert(apiKey);
      const userInfo = await cloudConvert.users.me();
      if (userInfo.credits !== undefined) {
        report.creditBalance = `💰 Remaining CloudConvert credits: ${userInfo.credits}`;
        if (userInfo.credits < 50) {
          report.creditBalance += " ⚠️ (Low balance — consider topping up soon)";
        }
      } else {
        report.creditBalance = "⚠️ Unable to read credit balance (possible sandbox key)";
      }
    } catch (err) {
      report.creditBalance = `❌ Credit check failed: ${err.message}`;
    }

    // --- Optional mini conversion test ---
    try {
      const job = await new CloudConvert(apiKey).jobs.create({
        tasks: {
          ping: { operation: "ping" }
        }
      });
      if (job.id) report.pdfConversion = "✅ CloudConvert API operational";
    } catch (err) {
      report.pdfConversion = `❌ CloudConvert API test failed: ${err.message}`;
    }

    report.final = "✅ Selftest complete.";
    return res.status(200).json(report);

  } catch (err) {
    report.final = `❌ Unhandled error: ${err.message}`;
    return res.status(500).json(report);
  }
}
