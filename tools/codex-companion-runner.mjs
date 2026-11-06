#!/usr/bin/env node
// Personal foreground process, outbound stdio MCP only. No local listener/service.
import {parseArgs,run,safeError} from './codex-draft-worker.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {diagnosticCode} from './codex-companion-session.mjs';
const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
try{
 const args=process.argv.slice(2),options=parseArgs(['--companion',...args]);
 if(options.help){process.stdout.write('개인 PC Codex 동반 작업자\n최초 연결: Codex CLI 로그인 → Toolkit MCP 개인 인증·연결코드 등록 → 이 명령 실행.\nnode tools/codex-companion-runner.mjs --watch [--workspace PATH] [--report UUID] [--label NAME]\n--check는 로그인·MCP·OS 격리만 검사하며 모델은 실행하지 않습니다. --watch는 계정 사용량을 소비합니다.\nPC가 켜져 있고 이 프로세스가 실행 중일 때만 자동 처리합니다. 최종 승인은 편집기에서 사람이 수행합니다.\n');}
 else{let failures=0;do{try{await run(options,{signal:controller.signal});failures=0;break;}catch(error){if(controller.signal.aborted)break;process.stderr.write(JSON.stringify({event:'companion_unavailable',error_code:diagnosticCode(error),message:safeError(error)})+'\n');if(options.mode!=='watch')throw error;if(++failures>=5){process.stderr.write(JSON.stringify({event:'companion_stopped',reason:'repeated_startup_failure'})+'\n');throw error;}await delay(Math.min(60000,10000*failures),undefined,{signal:controller.signal}).catch(()=>{});}}while(!controller.signal.aborted);}
}catch{process.exitCode=controller.signal.aborted?130:1;}finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
