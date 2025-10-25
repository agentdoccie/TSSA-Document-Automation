// api/validate-template.js
// Vercel-compatible handler to validate .docx template placeholders against provided data

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateDataAgainstTemplate } from '../lib/template-validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async function handler(req, res) {
  try {
    // Accept POST (preferred) and GET (convenience)
    const body = req.method === 'GET' ? req.query : req.body || {};
    const { templateName, data } = body;

    if (!templateName) {
      return res.status(400).json({ error: 'Missing templateName' });
    }

    const templatePath = path.join(__dirname, '..', 'templates', templateName);
    if (!fs.existsSync(templatePath)) {
      return res.status(404).json({ error: `Template not found: ${templateName}` });
    }

    const buffer = fs.readFileSync(templatePath);
    try {
      const validation = validateDataAgainstTemplate(buffer, data || {});
      return res.status(200).json({ tags: validation.tags, missing: validation.missing });
    } catch (err) {
      console.error('validate-template error', err);
      return res.status(500).json({ error: 'Failed to validate template', message: String(err.message) });
    }
  } catch (err) {
    console.error('validate-template unexpected error', err);
    return res.status(500).json({ error: 'Internal server error', message: String(err.message) });
  }
}