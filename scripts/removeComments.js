

const fs = require('fs');
const path = require('path');

const root = process.cwd(); 

function isTargetFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ['.js', '.ejs', '.json'].includes(ext);
}

function stripComments(content) {
  
  const withoutBlock = content.replace(/\/\*[\s\S]*?\*\
  
  const withoutLine = withoutBlock.replace(/(?<!:)\/\/.*$/gm, '');
  return withoutLine;
}

function processFile(filePath) {
  try {
    const original = fs.readFileSync(filePath, 'utf8');
    const stripped = stripComments(original);
    if (original !== stripped) {
      fs.writeFileSync(filePath, stripped, 'utf8');
      console.log(`Stripped comments from ${filePath}`);
    }
  } catch (err) {
    console.error(`Error processing ${filePath}:`, err.message);
  }
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      
      if (['node_modules', '.git', 'dist', 'build'].includes(entry.name)) continue;
      walk(fullPath);
    } else if (entry.isFile() && isTargetFile(fullPath)) {
      processFile(fullPath);
    }
  }
}

walk(root);
console.log('Comment removal complete.');
