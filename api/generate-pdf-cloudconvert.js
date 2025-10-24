import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import CloudConvert from "cloudconvert";

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

// 🛡️ Helper: Safe render (never crashes)
function safeRender(doc, data) {
  try {
    doc.render(data);
  } catch (error) {
    if (error.name === "MultiError" && Array.isArray(error.properties?.errors)) {
      const missing = error.properties.errors.map((e) => e.properties?.id || "unknown");
      console.warn("⚠️ Missing variables:", missing);
      // Fill missing keys with blanks and retry
      missing.forEach((key) => (data[key] = data[key] || ""));
      doc.render(data);
      return { ok: true, missing };
    } else {
      throw error;
    }
  }
  return { ok: true, missing: [] };
}

// ======= MAIN HANDLER =======
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const { fullName, witness1Name, witness1Email, witness2Name, witness2Email } = req.body;
    const data = {
      fullName,
      witness1Name,
      witness1Email,
      witness2Name,
      witness2Email,
      signatureDate: new Date().toLocaleDateString(),
    };

    const templatePath = path.join(process.cwd(), "templates", "CommonCarryDeclaration.docx");
    if (!fs.existsSync(templatePath)) {
      return res.status(404).json({ ok: false, error: "Template not found" });
    }

    // Binary-safe read
    const binaryContent = fs.readFileSync(templatePath, "binary");
    const { repairedContent, replacements } = autoRepairTemplate(binaryContent.toString());
    const zip = new PizZip(repairedContent, { base64: false });
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

    // 🧱 Render safely
    const renderResult = safeRender(doc, data);

    const buffer = doc.getZip().generate({ type: "nodebuffer" });
    const outputDocxPath = path.join(process.cwd(), "temp", "CommonCarryDeclaration_output.docx");

    if (!fs.existsSync(path.join(process.cwd(), "temp"))) {
      fs.mkdirSync(path.join(process.cwd(), "temp"));
    }

    fs.writeFileSync(outputDocxPath, buffer);

    // 🧾 Try PDF conversion
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
        message: "✅ PDF generated successfully (self-healing mode).",
        fileUrl,
        replacements,
        renderResult,
      });
    } catch (pdfErr) {
      console.warn("⚠️ PDF conversion failed:", pdfErr.message);

      return res.status(200).json({
        ok: true,
        message: "⚙️ Fallback to DOCX — PDF conversion failed.",
        fallback: "docx",
        replacements,
        renderResult,
      });
    }
  } catch (err) {
    console.error("❌ Generator fatal error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
