import { spawnSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const bundled=join(homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','python','python.exe');
const choices=[...(process.env.POS_PYTHON?[[process.env.POS_PYTHON,[]]]:[]),...(process.platform==='win32'?[['py',['-3']],...(existsSync(bundled)?[[bundled,[]]]:[])]:[]),['python3',[]],['python',[]]];
const selected=choices.find(([command,args])=>spawnSync(command,[...args,'-c','import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)'],{stdio:'ignore',windowsHide:true}).status===0);
if(!selected){console.error('Instala Python 3.11 o superior para iniciar el servidor local.');process.exit(1);}
console.log('Abre http://127.0.0.1:8765/ · Ctrl+C para detener');
const child=spawn(selected[0],[...selected[1],'server.py'],{cwd:root,stdio:'inherit',windowsHide:true});
child.on('error',e=>{console.error(e.message);process.exitCode=1});
child.on('exit',code=>{process.exitCode=code||0});
process.on('SIGINT',()=>child.kill('SIGINT'));
