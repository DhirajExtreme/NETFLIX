const fs = require('fs');
const path = require('path');

function replaceInFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Replace JS variables
  content = content.replace(/StreamVaultApp/g, 'DSPlixApp');
  content = content.replace(/StreamVaultAPI/g, 'DSPlixAPI');
  
  // Replace user-facing strings and comments
  content = content.replace(/StreamVault/g, 'DS PLIX');
  
  // Replace package name, lowercase uses
  content = content.replace(/streamvault/g, 'ds-plix');
  
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Updated ${filePath}`);
}

const filesToUpdate = [
  'server.js',
  'package.json',
  'src/db/database.js',
  'public/index.html',
  'public/js/app.js',
  'public/js/api.js',
  'public/js/components/hero.js',
  'public/js/components/navbar.js',
  'public/js/components/settings.js',
  'public/js/components/mediaDetail.js',
  'public/js/components/mediaCard.js',
  'public/js/components/search.js',
  'public/js/components/player.js'
];

filesToUpdate.forEach(f => replaceInFile(path.join(__dirname, f)));
console.log('Renaming complete.');
