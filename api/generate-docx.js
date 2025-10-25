// api/generate-docx.js
// Safer generator: validates template placeholders before rendering with docxtemplater.
// Place this file in api/ (replacing or alongside your existing handler).
// Exports a default function compatible with Vercel serverless handlers (req, res).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { validateDataAgainstTemplate } from '../lib/template-validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function makeExamplePayload(tags) {
  const example = {};
  for (const t of tags) {
    example[t] = '<value>';
  }
  return example;
}

function validationErrorResponse(res, missing, tags) {
  return res.status(422).json({
    error: 'Template validation failed: missing placeholders',
    missing,
    requiredPlaceholders: tags,
    examplePayload: makeExamplePayload(tags),
    message: `Template requires ${tags.length} placeholders; ${missing.length} are missing.`,
  });
}

export default async function handler(req, res) {
  try {
    // Expect JSON body with { templateName, data }
    const { templateName, data } = req.body || {};
    if (!templateName) {
      return res.status(400).json({ error: 'Missing templateName in request body' });
    }

    const templatePath = path.join(__dirname, '..', 'templates', templateName);
    if (!fs.existsSync(templatePath)) {
      return res.status(404).json({ error: `Template not found: ${templateName}` });
    }

    const buffer = fs.readFileSync(templatePath);

    // Validate that provided data covers all placeholders.
    let validation;
    try {
      validation = validateDataAgainstTemplate(buffer, data || {});
    } catch (vErr) {
      console.error('Template validation failure', vErr);
      return res.status(500).json({ error: 'Failed to read template tags', message: String(vErr.message) });
    }

    const { tags, missing } = validation;
    if (missing.length > 0) {
      return validationErrorResponse(res, missing, tags);
    }

    // All placeholders present -> render the docx
    try {
      const zip = new PizZip(buffer);
      const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
      doc.setData(data || {});
      doc.render();
      const outBuffer = doc.getZip().generate({ type: 'nodebuffer' });

      const filename = `${path.basename(templateName).replace(/\.[^.]+$/, '')}-output.docx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(outBuffer);
    } catch (renderErr) {
      // Docxtemplater sometimes throws an object with .properties
      console.error('Docxtemplater render error', renderErr);
      const message = renderErr && renderErr.message ? renderErr.message : String(renderErr);
      const details = renderErr && renderErr.properties ? renderErr.properties : undefined;
      return res.status(500).json({ error: 'Failed to render template', message, details });
    }
  } catch (err) {
    console.error('generate-docx unexpected error', err);
    return res.status(500).json({ error: 'Internal server error', message: err?.message ?? String(err) });
  }
}
