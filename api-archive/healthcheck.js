// /api/healthcheck.js
import fs from "fs";
import path from "path";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

  const out = {
    ok: true,
    template: false,
    cloudConvertKey: false,
    credits: null,
    message: "",
  };

  try {
    const templatePath = path.join(process.cwd(), "templates", "CommonCarryDeclaration.docx");
    out.template = fs.existsSync(templatePath);

    const ccKey = process.env.CLOUDCONVERT_API_KEY || "";
    out.cloudConvertKey = !!ccKey.trim();

    if (out.cloudConvertKey) {
      try {
        const r = await fetch("https://api.cloudconvert.com/v2/credits", {
          headers: { Authorization: `Bearer ${ccKey}` }
        });
        const j = await r.json();
        if (r.ok && j?.data?.credits != null) {
          out.credits = j.data.credits;
        } else {
          out.credits = null;
        }
      } catch {
        out.credits = null;
      }
    }

    // Build message
    if (!out.template) {
      out.ok = false;
      out.message = "Template missing.";
    } else if (!out.cloudConvertKey) {
      out.message = "Local PDF active; CloudConvert key not set.";
    } else if (out.credits === 0) {
      out.ok = false;
      out.message = "CloudConvert credits exhausted.";
    } else if (out.credits != null && out.credits <= 50) {
      out.message = `Low CloudConvert credits: ${out.credits}`;
    } else {
      out.message = "System operational.";
    }

    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
}
