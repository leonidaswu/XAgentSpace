import path from 'node:path';
import { DEFAULT_SQLITE_FILE, JsonFilePlatformStorage, SqlitePlatformStorage } from '../apps/server/src/storage.ts';

function readArg(name: string) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }

  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const sourcePath = path.resolve(readArg('--from') ?? DEFAULT_SQLITE_FILE);
const targetPath = path.resolve(readArg('--to') ?? 'data/platform-state.exported.json');

const source = new SqlitePlatformStorage(sourcePath);
const state = source.load();
source.close();

if (!state) {
  throw new Error(`No SQLite platform state found at ${sourcePath}`);
}

const target = new JsonFilePlatformStorage(targetPath);
target.save(state);

console.log(`Exported ${sourcePath} -> ${targetPath}`);
