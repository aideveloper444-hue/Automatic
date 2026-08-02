import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const provider = process.argv[2];
const validProviders = ['sqlite', 'postgresql'];

if (!validProviders.includes(provider)) {
  console.error(`Usage: node scripts/switch-db-provider.js <${validProviders.join('|')}>`);
  process.exit(1);
}

const prismaDir = path.resolve(__dirname, '..', 'prisma');
const sourceFile = path.join(prismaDir, `schema.${provider}.prisma`);
const targetFile = path.join(prismaDir, 'schema.prisma');

if (!fs.existsSync(sourceFile)) {
  console.error(`Source schema not found: ${sourceFile}`);
  process.exit(1);
}

fs.copyFileSync(sourceFile, targetFile);

console.log(`prisma/schema.prisma now targets "${provider}".`);
console.log('Next steps:');
console.log('  1. Update DATABASE_URL in your .env file for the new provider.');
console.log('  2. Run "npm run prisma:generate".');
console.log('  3. Run "npm run prisma:migrate" (dev) or "npx prisma migrate deploy" (production).');
