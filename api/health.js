import fs from "fs";
import path from "path";

export default async function handler(req, res) {
  const results = {};

  // 1. Check the CommonCarryDeclaration.docx template
  const templatePath = path.join(process.cwd(), "templates", "CommonCarryDeclaration.docx");
  try {
    await fs.promises.access(templatePath, fs.constants.R_OK);
    results.template = "✅ Template file found.";
  } catch {
    results.template = `❌ Missing or unreadable template at ${templatePath}`;
  }

  // 2. Check CloudConvert API key
  const apiKey = process.env.CLOUDCONVERT_API_KEY;
  results.cloudconvertKey = apiKey
    ? `✅ CloudConvert key detected (${apiKey.slice(0, 6)}...hidden)`
    : "❌ No CloudConvert API key found.";

  // 3. Return results
  return res.status(200).json(results);
}
