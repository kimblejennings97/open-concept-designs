// Runs Vitest with the Windows drive letter upper-cased in the working directory.
// Some terminals (Git Bash, VS Code) start in "c:\..." while Node resolves modules under "C:\...";
// Vitest then loads two copies of itself and every suite fails with
// "Cannot read properties of undefined (reading 'config')".
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

let cwd = process.cwd();
if (process.platform === 'win32' && /^[a-z]:/.test(cwd)) cwd = cwd[0].toUpperCase() + cwd.slice(1);

const bin = join(cwd, 'node_modules', 'vitest', 'vitest.mjs');
const res = spawnSync(process.execPath, [bin, ...process.argv.slice(2)], { cwd, stdio: 'inherit' });
process.exit(res.status ?? 1);
