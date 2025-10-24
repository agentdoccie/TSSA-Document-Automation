import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import CloudConvert from "cloudconvert";

// Initialize CloudConvert
const cloudConvert = new CloudConvert(process.env.CLOUDCONVERT_API_KEY);

// --- Helper function: Auto-scan and repair template placeholders ---
function autoRepairTemplate(content) {
  const correctTags = {
    FULL_NAME: "fullName",
    WITNESS_1_NAME: "witness1Name",
    WITNESS_1_EMAIL: "witness1Email",
    WITNESS_2_NAME: "witness2Name",
    WITNESS_2_EMAIL: "witness2Email",
    SIGNATURE_DATE: "signatureDate"
  };

  let repairedContent = content;
  let replacements = [];

  for (const [wrongTag, rightTag] of Object.entries(correctTags)) {
    const regex = new RegExp(`{{\\s*${wrongTag}\\s*}}`, "g");
    if (regex.test(repairedContent)) {
      repairedContent = repairedContent.replace(regex, `{{${rightTag}}}`);
      replacements.push({ from: wrongTag, to: rightTag });
    }
  }

  return { repairedContent, replacements };
}

// --- Main API route ---
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    // 1️⃣ Collect form data
    const {
      fullName,
      witness1Name,
      witness1Email,
      witness2Name,
      witness2Email
    } = req.body;

    // 2️⃣ Load template
    const templatePath = path.join(process.cwd(), "templates", "CommonCarryDeclaration.docx");
    if (!fs.existsSync(templatePath)) {
      return res.status(404).json({ ok: false, error: "Template not found" });
    }

    let content = fs.readFileSync(templatePath, "utf8");

    // 3️⃣ Auto-repair placeholders before rendering
    const { repairedContent, replacements } = autoRepairTemplate(content);
    if (replacements.length > 0) {
      const fixedPath = templatePath.replace(".docx", "_fixed.docx");
      fs.writeFileSync(fixedPath, repairedContent, "utf8");
      console.log(`✅ Auto-repaired and saved fixed version: ${fixedPath}`);
    }

    // 4️⃣ Render DOCX
    const zip = new PizZip(repairedContent);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

    doc.render({
      fullName,
      witness1Name,
      witness1Email,
      witness2Name,
      witness2Email,
      signatureDate: new Date().toLocaleDateString()
    });

    const buffer = doc.getZip().generate({ type: "nodebuffer" });
    const outputDocxPath = path.join(process.cwd(), "temp", "CommonCarryDeclaration_output.docx");
    fs.writeFileSync(outputDocxPath, buffer);

    // 5️⃣ Try to convert DOCX → PDF
    try {
      const job = await cloudConvert.jobs.create({
        tasks: {
          "import-my-file": {
            operation: "import/upload"
          },
          "convert-my-file": {
            operation: "convert",
            input: "import-my-file",
            input_format: "docx",
            output_format: "pdf"
          },
          "export-my-file": {
            operation: "export/url",
            input: "convert-my-file"
          }
        }
      });

      const uploadTask = job.tasks.find(task => task.name === "import-my-file");
      const uploadUrl = uploadTask.result.form.url;
      const formData = new FormData();

      for (const [key, value] of Object.entries(uploadTask.result.form.parameters)) {
        formData.append(key, value);
      }
      formData.append("file", fs.createReadStream(outputDocxPath));

      await fetch(uploadUrl, { method: "POST", body: formData });

      const completedJob = await cloudConvert.jobs.wait(job.id);
      const exportTask = completedJob.tasks.find(task => task.name === "export-my-file");
      const fileUrl = exportTask.result.files[0].url;

      return res.status(200).json({
        ok: true,
        message: "✅ PDF generated successfully (auto-repaired).",
        fileUrl,
        replacements
      });
    } catch (pdfErr) {
      console.warn("⚠️ PDF conversion failed, fallback to DOCX.", pdfErr.message);

      return res.status(200).json({
        ok: true,
        message: "⚠️ PDF conversion failed — fallback to DOCX only.",
        fallback: "docx",
        replacements
      });
    }
  } catch (err) {
    console.error("Unhandled generator error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
