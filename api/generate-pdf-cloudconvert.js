// ======= /api/generate-pdf-cloudconvert.js =======

import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import CloudConvert from "cloudconvert";

// Initialize CloudConvert client
const cloudConvert = new CloudConvert(process.env.CLOUDCONVERT_API_KEY);

// 🧩 Helper: auto-repair placeholder names
function autoRepairTemplate(content) {
  const correctTags = {
    FULL_NAME: "fullName",
    WITNESS_1_NAME: "witness1Name",
    WITNESS_1_EMAIL: "witness1Email",
    WITNESS_2_NAME: "witness2Name",
    WITNESS_2_EMAIL: "witness2Email",
    SIGNATURE_DATE: "signatureDate",
  };

  let repairedContent = content;
  const replacements = [];

  for (const [wrongTag, rightTag] of Object.entries(correctTags)) {
    const regex = new RegExp(`{{\\s*${wrongTag}\\s*}}`, "g");
    if (regex.test(repairedContent)) {
      repairedContent = repairedContent.replace(regex, `{{${rightTag}}}`);
      replacements.push({ from: wrongTag, to: rightTag });
    }
  }

  return { repairedContent, replacements };
}

// ======= MAIN HANDLER =======
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const { fullName, witness1Name, witness1Email, witness2Name, witness2Email } = req.body;

    // 🧠 1. Load template safely
    const templatePath = path.join(process.cwd(), "templates", "CommonCarryDeclaration.docx");
    if (!fs.existsSync(templatePath)) {
      return res.status(404).json({ ok: false, error: "Template not found" });
    }

    // ✅ Binary-safe read (no corruption)
    let binaryContent = fs.readFileSync(templatePath, "binary");

    // 🛠 2. Auto-repair placeholders on a text version
    let textVersion = binaryContent.toString();
    const { repairedContent, replacements } = autoRepairTemplate(textVersion);

    // ✅ Convert repaired text back to binary and zip
    const zip = new PizZip(repairedContent, { base64: false });

    // 🧱 3. Render DOCX with user data
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
    doc.render({
      fullName,
      witness1Name,
      witness1Email,
      witness2Name,
      witness2Email,
      signatureDate: new Date().toLocaleDateString(),
    });

    // 🗂 Save rendered DOCX
    const buffer = doc.getZip().generate({ type: "nodebuffer" });
    const outputDocxPath = path.join(process.cwd(), "temp", "CommonCarryDeclaration_output.docx");

    if (!fs.existsSync(path.join(process.cwd(), "temp"))) {
      fs.mkdirSync(path.join(process.cwd(), "temp"));
    }

    fs.writeFileSync(outputDocxPath, buffer);

    // 🧾 4. Try CloudConvert PDF conversion
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

      formData.append("file", fs.createReadStream(outputDocxPath));
      await fetch(uploadUrl, { method: "POST", body: formData });

      const completedJob = await cloudConvert.jobs.wait(job.id);
      const exportTask = completedJob.tasks.find((t) => t.name === "export-my-file");
      const fileUrl = exportTask.result.files[0].url;

      return res.status(200).json({
        ok: true,
        message: "✅ PDF generated successfully (auto-repaired).",
        fileUrl,
        replacements,
      });
    } catch (pdfErr) {
      console.warn("⚠️ PDF conversion failed, fallback to DOCX only:", pdfErr.message);

      return res.status(200).json({
        ok: true,
        message: "⚠️ PDF conversion failed — fallback to DOCX only.",
        fallback: "docx",
        replacements,
      });
    }
  } catch (err) {
    console.error("❌ Unhandled generator error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
