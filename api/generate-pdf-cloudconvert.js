// ======= /api/generate-pdf-cloudconvert.js =======
import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import CloudConvert from "cloudconvert";

const cloudConvert = new CloudConvert(process.env.CLOUDCONVERT_API_KEY);

// 🔍 Scan all {{tags}} inside the template automatically
function extractTags(content) {
  const regex = /{{\s*([^}\s]+)\s*}}/g;
  const found = new Set();
  let match;
  while ((match = regex.exec(content))) found.add(match[1]);
  return Array.from(found);
}

// 🧩 Automatically fix tag naming (legacy → new)
function normalizeTags(content) {
  const map = {
    FULL_NAME: "fullName",
    WITNESS_1_NAME: "witness1Name",
    WITNESS_1_EMAIL: "witness1Email",
    WITNESS_2_NAME: "witness2Name",
    WITNESS_2_EMAIL: "witness2Email",
    SIGNATURE_DATE: "signatureDate",
  };
  for (const [oldTag, newTag] of Object.entries(map)) {
    const regex = new RegExp(`{{\\s*${oldTag}\\s*}}`, "g");
    content = content.replace(regex, `{{${newTag}}}`);
  }
  return content;
}

// 🛡 Safe render — auto-fill missing fields
function safeRender(doc, data, tags) {
  const copy = { ...data };
  tags.forEach((t) => {
    if (copy[t] === undefined) copy[t] = "";
  });

  try {
    doc.render(copy);
    return { ok: true, missing: [] };
  } catch (err) {
    console.warn("⚠️ Fallback render triggered:", err.message);
    const missing = (err.properties?.errors || []).map((e) => e.properties?.id);
    missing.forEach((t) => (copy[t] = ""));
    doc.render(copy);
    return { ok: true, missing };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const { fullName, witness1Name, witness1Email, witness2Name, witness2Email } = req.body;
    const templatePath = path.join(process.cwd(), "templates", "CommonCarryDeclaration.docx");

    if (!fs.existsSync(templatePath)) {
      return res.status(404).json({ ok: false, error: "Template not found" });
    }

    const binary = fs.readFileSync(templatePath, "binary");
    const normalized = normalizeTags(binary.toString());
    const tags = extractTags(normalized);
    const zip = new PizZip(normalized, { base64: false });
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

    const data = {
      fullName,
      witness1Name,
      witness1Email,
      witness2Name,
      witness2Email,
      signatureDate: new Date().toLocaleDateString(),
    };

    const renderResult = safeRender(doc, data, tags);

    // Save DOCX
    const buffer = doc.getZip().generate({ type: "nodebuffer" });
    const outDir = path.join(process.cwd(), "temp");
    const outDocx = path.join(outDir, "CommonCarryDeclaration_output.docx");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
    fs.writeFileSync(outDocx, buffer);

    // Try PDF conversion
    try {
      const job = await cloudConvert.jobs.create({
        tasks: {
          "import-my-file": { operation: "import/upload" },
          "convert-my-file": {
            operation: "convert",
            input: "import-my-file",
            input_format: "docx",
            output_format: "pdf",
          },
          "export-my-file": { operation: "export/url", input: "convert-my-file" },
        },
      });

      const uploadTask = job.tasks.find((t) => t.name === "import-my-file");
      const uploadUrl = uploadTask.result.form.url;
      const formData = new FormData();
      for (const [key, value] of Object.entries(uploadTask.result.form.parameters)) {
        formData.append(key, value);
      }
      formData.append("file", fs.createReadStream(outDocx));
      await fetch(uploadUrl, { method: "POST", body: formData });

      const completedJob = await cloudConvert.jobs.wait(job.id);
      const exportTask = completedJob.tasks.find((t) => t.name === "export-my-file");
      const fileUrl = exportTask.result.files[0].url;

      return res.status(200).json({
        ok: true,
        message: "✅ PDF generated successfully (auto-healing enabled).",
        fileUrl,
        tagsFound: tags,
        renderResult,
      });
    } catch (pdfErr) {
      console.warn("⚠️ PDF conversion failed:", pdfErr.message);
      return res.status(200).json({
        ok: true,
        message: "⚙️ Fallback: PDF conversion failed — DOCX generated instead.",
        fallback: "docx",
        tagsFound: tags,
        renderResult,
      });
    }
  } catch (err) {
    console.error("❌ Unhandled:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
