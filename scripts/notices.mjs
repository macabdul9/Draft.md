import fs from 'node:fs/promises';
import path from 'node:path';
const lock = JSON.parse(await fs.readFile('package-lock.json', 'utf8'));
const sections = [
  'Draft.md — third-party notices\nGenerated from the installed production dependency graph. Individual upstream licenses apply.\n',
];
for (const [directory, record] of Object.entries(lock.packages)) {
  if (!directory || record.dev) continue;
  const entries = await fs.readdir(directory).catch(() => []);
  const license = entries.find((name) => /^licen[sc]e(?:\.(?:md|txt))?$/i.test(name));
  const packageJSON = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
  sections.push(
    `\n${packageJSON.name}@${packageJSON.version}\nLicense: ${record.license ?? packageJSON.license ?? 'See upstream distribution'}\n${license ? await fs.readFile(path.join(directory, license), 'utf8') : 'License notice is available in the upstream package.'}\n`,
  );
}
await fs.writeFile('public/THIRD_PARTY_NOTICES.txt', sections.join('\n'));
console.log(`Wrote ${sections.length - 1} dependency notices.`);
