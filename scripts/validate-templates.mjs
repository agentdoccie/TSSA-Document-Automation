#!/usr/bin/env node
/**
 * scripts/validate-templates.mjs
 * 
 * CLI script that validates all .docx templates in the templates/ directory.
 * 
 * Features:
 * - Validates that each .docx template can be parsed by docxtemplater
 * - Extracts and reports placeholders/tags from each template
 * - Checks for corresponding schema files (*.schema.json)
 * - Exits with non-zero status if validation fails
 * 
 * Usage:
 *   node scripts/validate-templates.mjs
 *   npm run validate-templates
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractTemplateTags } from '../lib/template-validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const SCHEMAS_DIR = path.join(__dirname, '..', 'schemas');

// ANSI color codes for better CLI output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function getDocxFiles(directory) {
  if (!fs.existsSync(directory)) {
    throw new Error(`Templates directory not found: ${directory}`);
  }

  const files = fs.readdirSync(directory);
  return files.filter(file => file.endsWith('.docx'));
}

function validateTemplate(templatePath, templateName) {
  const result = {
    name: templateName,
    valid: false,
    tags: [],
    errors: [],
    warnings: [],
    hasSchema: false,
    schemaPath: null,
  };

  try {
    // Read the template file
    const buffer = fs.readFileSync(templatePath);
    
    // Extract tags from the template
    try {
      const tags = extractTemplateTags(buffer);
      result.tags = tags;
      result.valid = true;
    } catch (extractError) {
      result.errors.push({
        type: 'extraction_error',
        message: extractError.message,
        details: extractError.original ? extractError.original.message : null,
      });
    }

    // Check for corresponding schema file
    const baseName = templateName.replace(/\.docx$/i, '');
    const schemaPath = path.join(SCHEMAS_DIR, `${baseName}.schema.json`);
    
    if (fs.existsSync(schemaPath)) {
      result.hasSchema = true;
      result.schemaPath = schemaPath;
      
      // Optionally validate schema format
      try {
        const schemaContent = fs.readFileSync(schemaPath, 'utf8');
        JSON.parse(schemaContent);
      } catch (schemaError) {
        result.warnings.push({
          type: 'invalid_schema',
          message: `Schema file exists but is not valid JSON: ${schemaError.message}`,
        });
      }
    } else {
      result.warnings.push({
        type: 'missing_schema',
        message: `No schema file found at ${schemaPath}`,
      });
    }
  } catch (error) {
    result.errors.push({
      type: 'general_error',
      message: error.message,
    });
  }

  return result;
}

function reportResults(results) {
  log('\n========================================', 'cyan');
  log('  Template Validation Report', 'cyan');
  log('========================================\n', 'cyan');

  let hasErrors = false;
  let hasWarnings = false;

  for (const result of results) {
    const status = result.valid ? '✓' : '✗';
    const statusColor = result.valid ? 'green' : 'red';
    
    log(`${status} ${result.name}`, statusColor);
    
    if (result.tags.length > 0) {
      log(`  Tags found: ${result.tags.length}`, 'blue');
      log(`  Placeholders: ${result.tags.join(', ')}`, 'blue');
    }

    if (result.hasSchema) {
      log(`  ✓ Schema file found`, 'green');
    }

    if (result.errors.length > 0) {
      hasErrors = true;
      for (const error of result.errors) {
        log(`  ✗ Error: ${error.message}`, 'red');
        if (error.details) {
          log(`    Details: ${error.details}`, 'red');
        }
      }
    }

    if (result.warnings.length > 0) {
      hasWarnings = true;
      for (const warning of result.warnings) {
        log(`  ⚠ Warning: ${warning.message}`, 'yellow');
      }
    }

    console.log(''); // Empty line between templates
  }

  // Summary
  log('========================================', 'cyan');
  const validCount = results.filter(r => r.valid).length;
  const totalCount = results.length;
  
  log(`Valid templates: ${validCount}/${totalCount}`, validCount === totalCount ? 'green' : 'yellow');
  
  if (hasErrors) {
    log('Status: FAILED - Templates have errors', 'red');
  } else if (hasWarnings) {
    log('Status: PASSED with warnings', 'yellow');
  } else {
    log('Status: PASSED - All templates valid', 'green');
  }
  
  log('========================================\n', 'cyan');

  return !hasErrors;
}

async function main() {
  try {
    log('Starting template validation...', 'cyan');
    log(`Templates directory: ${TEMPLATES_DIR}`, 'blue');
    log(`Schemas directory: ${SCHEMAS_DIR}`, 'blue');
    console.log('');

    // Get all .docx files
    const docxFiles = getDocxFiles(TEMPLATES_DIR);
    
    if (docxFiles.length === 0) {
      log('⚠ No .docx templates found in templates directory', 'yellow');
      return true;
    }

    log(`Found ${docxFiles.length} template(s) to validate\n`, 'blue');

    // Validate each template
    const results = [];
    for (const fileName of docxFiles) {
      const templatePath = path.join(TEMPLATES_DIR, fileName);
      const result = validateTemplate(templatePath, fileName);
      results.push(result);
    }

    // Report results
    const success = reportResults(results);
    
    // Exit with appropriate code
    process.exit(success ? 0 : 1);
  } catch (error) {
    log(`\n✗ Fatal error: ${error.message}`, 'red');
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run the script
main();
