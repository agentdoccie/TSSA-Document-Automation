import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import fs from "fs";
import path from "path";
import { metrics } from "./metrics.js";

export default async function handler(req, res) {
  const startTime = Date.now();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { templates, data } = req.body;
    if (!templates || !data) {
      metrics.totalFailures++;
      return res.status(400).json({ error: "Missing templates or data" });
    }

    metrics.totalRequests++;

    const results = [];
    for (const template of templates) {
      const templatePath = path.join(process.cwd(), "templates", template);

      if (!fs.existsSync(templatePath)) {
        metrics.totalFailures++;
        results.push({ template, status: "MISSING" });
        continue;
      }

      const content = fs.readFileSync(templatePath);
      const zip = new PizZip(content);
      const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

      doc.setData(data);
      doc.render();

      const buffer = doc.getZip().generate({ type: "nodebuffer" });
      const outputPath = path.join(process.cwd(), "public", `${template}-output.docx`);
      fs.writeFileSync(outputPath, buffer);

      results.push({ template, status: "SUCCESS", output: `${template}-output.docx` });
    }

    metrics.totalGenerationTime += Date.now() - startTime;

    res.status(200).json({
      success: true,
      results,
      metrics: {
        totalRequests: metrics.totalRequests,
        totalFailures: metrics.totalFailures,
        averageGenerationTime: metrics.averageGenerationTime,
      },
    });
  } catch (error) {
    metrics.totalFailures++;
    res.status(500).json({ error: error.message });
  }
}
