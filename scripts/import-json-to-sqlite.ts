import path from 'node:path';
import { DEFAULT_STATE_FILE, JsonFilePlatformStorage, SqlitePlatformStorage } from '../apps/server/src/storage.ts';

function readArg(name: string) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }

  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const sourcePath = path.resolve(readArg('--from') ?? DEFAULT_STATE_FILE);
const targetPath = path.resolve(readArg('--to') ?? 'data/platform-state.sqlite');

const source = new JsonFilePlatformStorage(sourcePath);
const state = source.load();

if (!state) {
  throw new Error(`No JSON platform state found at ${sourcePath}`);
}

const target = new SqlitePlatformStorage(targetPath);
target.save(state);
target.close();

console.log(`Imported ${sourcePath} -> ${targetPath}`);
