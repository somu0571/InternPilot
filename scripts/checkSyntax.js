// checkSyntax.js
// Walk through project and run `node -c` on each .js file, reporting any syntax errors.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = process.cwd();

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'build'].includes(entry.name)) continue;
      walk(fullPath);
    } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.js') {
      try {
        execSync(`node -c "${fullPath}"`, { stdio: 'ignore' });
      } catch (e) {
        console.error(`Syntax error in ${fullPath}:`);
        console.error(e.stderr ? e.stderr.toString() : e.message);
        process.exitCode = 1;
      }
    }
  }
}

walk(root);
if (process.exitCode !== 0) {
  console.error('Syntax check failed.');
} else {
  console.log('All JS files passed syntax check.');
}
