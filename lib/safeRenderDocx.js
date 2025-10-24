// lib/safeRenderDocx.js
import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import crypto from "crypto";

/**
 * Safe DOCX rendering with:
 *  - template pre-scan (collects {{tags}})
 *  - auto-normalization (FULL_NAME -> fullName)
 *  - missing keys auto-filled with ""
 *  - docxtemplater nullGetter to prevent throws
 *  - /tmp-only output for serverless
 * Returns { ok, docxPath, warnings[], tagsFound[], usedData, correlationId }
 */
export async function safeRenderDocx({
  templateFile,     // e.g. "CommonCarryDeclaration.docx"
  data,             // payload from frontend
  templateDir = "templates",
  outDir = "/tmp",
}) {
  const correlationId = crypto.randomBytes(8).toString("hex");
  const warnings = [];

  try {
    // 1) Resolve & read the template (binary-safe)
    const templatePath = path.join(process.cwd(), templateDir, templateFile);
    if (!fs.existsSync(templatePath)) {
      return {
        ok: false, correlationId,
        error: `Template not found: ${templateFile}`,
        warnings
      };
    }
    const binaryContent = fs.readFileSync(templatePath, "binary");
    const zip = new PizZip(binaryContent);

    // 2) Pre-scan template for {{tags}}
    const docXml = zip.files["word/document.xml"].asText();
    const tagRegex = /{{\s*([^}\s]+)\s*}}/g;
    const tagsFoundSet = new Set();
    let m; while ((m = tagRegex.exec(docXml))) tagsFoundSet.add(m[1]);
    const tagsFound = Array.from(tagsFoundSet);

    // 3) Build a normalization map (UPPER_SNAKE -> lowerCamel)
    const toLowerCamel = (s) =>
      s.toLowerCase().split("_").map((p,i)=> i===0 ? p : (p[0]||"").toUpperCase()+p.slice(1)).join("");

    const neededKeys = tagsFound.map(tag => ({
      tag,
      lowerCamel: /^[A-Z0-9_]+$/.test(tag) ? toLowerCamel(tag) : tag
    }));

    // 4) Construct the render data safely
    const renderData = {};
    const missingKeys = [];
    for (const { tag, lowerCamel } of neededKeys) {
      // prefer exact match
      if (data.hasOwnProperty(tag)) {
        renderData[tag] = (data[tag] ?? "");
      } else if (data.hasOwnProperty(lowerCamel)) {
        renderData[tag] = (data[lowerCamel] ?? "");
      } else {
        // still missing → blank, but don't crash
        renderData[tag] = "";
        missingKeys.push(tag);
      }
    }
    if (missingKeys.length) {
      warnings.push({
        kind: "missing_keys",
        message: `Missing data for ${missingKeys.length} tag(s). Filled with blanks.`,
        keys: missingKeys
      });
    }

    // 5) Configure docxtemplater to NEVER throw on null/missing
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => "" // critical: prevents XTemplateError
    });

    // 6) Render
    try {
      doc.render(renderData);
    } catch (e) {
      // If docxtemplater still complains (rare), degrade gracefully
      warnings.push({
        kind: "render_warning",
        message: "Docxtemplater render warning; continuing with best-effort.",
        detail: e.message
      });
    }

    // 7) Generate nodebuffer and write ONLY to /tmp
    const outBuffer = doc.getZip().generate({ type: "nodebuffer" });
    const outName = templateFile.replace(/\.docx$/i, `_${correlationId}.docx`);
    const outPath = path.join(outDir, outName);
    fs.writeFileSync(outPath, outBuffer);

    return {
      ok: true,
      correlationId,
      docxPath: outPath,
      tagsFound,
      usedData: renderData,
      warnings
    };
  } catch (err) {
    return {
      ok: false,
      correlationId,
      error: err.message || String(err),
      warnings
    };
  }
}
