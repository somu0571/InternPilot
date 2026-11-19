// safeRemoveComments.js
// Recursively walk the project and strip comments from source files.
// For each file we attempt the stripping, then run `node -c` on the result.
// Only if the syntax check passes do we overwrite the original file.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = process.cwd();
const targetExt = ['.js', '.ejs', '.json'];

function isTarget(filePath) {
  return targetExt.includes(path.extname(filePath).toLowerCase());
}

function stripComments(content) {
  // Remove block comments (including JSDoc) – naive but works for most code.
  let withoutBlock = content.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove line comments that are not part of URLs (http:// or https://).
  // Use negative lookbehind to ensure not preceded by ':' (to keep "http://").
  let withoutLine = withoutBlock.replace(/(?<!:)\/\/.*$/gm, '');
  return withoutLine;
}

function processFile(filePath) {
  try {
    const original = fs.readFileSync(filePath, 'utf8');
    const stripped = stripComments(original);
    if (original === stripped) return; // nothing changed

    // Write to a temporary file for syntax checking.
    const tempPath = filePath + '.tmp';
    fs.writeFileSync(tempPath, stripped, 'utf8');
    try {
      execSync(`node -c "${tempPath}"`, { stdio: 'ignore' });
      // Syntax ok – replace original.
      fs.writeFileSync(filePath, stripped, 'utf8');
      console.log(`Stripped comments from ${filePath}`);
    } catch (e) {
      // Syntax failed – keep original.
      console.warn(`Skipping ${filePath}: syntax check failed after comment removal`);
    } finally {
      // Clean up temp file.
      fs.unlinkSync(tempPath);
    }
  } catch (err) {
    console.error(`Error processing ${filePath}: ${err.message}`);
  }
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'build'].includes(entry.name)) continue;
      walk(full);
    } else if (entry.isFile() && isTarget(full)) {
      processFile(full);
    }
  }
}

walk(root);
console.log('Safe comment removal complete.');
