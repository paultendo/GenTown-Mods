import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCampaign, validateOptions, POLICIES } from './lib/campaign.mjs';

export const help = `Run actual GenTown campaigns without a browser or real-time day delays.

npm run simulate -- --days 1000 --seeds 7,42,123 --policies yes,mixed,skip
npm run simulate -- --save /path/to/world.planet --days 500 --policy mixed

--days N             Turns to advance (default 1000)
--seeds N,N          Reproducible random seeds (default 42)
--policy NAME        yes, no, mixed or skip (default mixed)
--policies NAME,NAME Compare several policies against the same seeds
--save FILE          Continue an exported world in an isolated simulation
--site NAME          fertile (default) or first habitable chunk, for new worlds
--checkpoint N       Export and report every N turns (default 100)
--stall-after N      Flag work unchanged for N days (default 30)
--out DIR            New output directory (default a unique temporary directory)
--help               Show this help

Each run writes a report, timeline and importable .planet saves. The engine,
mod follow-ups, timers, costs and automatic events all run. No live browser save
is read or changed. Skip uses each native event's actual lapse behaviour.
Mixed makes seeded random choices; it is not a model of a skilled player.`;

export function parseArguments(args) {
  const options = { days: 1000, seeds: [42], policies: ['mixed'], checkpointEvery: 100, site: 'fertile', stallAfter: 30 };
  const allowed = new Set(['--days', '--seed', '--seeds', '--policy', '--policies', '--save', '--site', '--checkpoint', '--stall-after', '--out']);
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--help' || flag === '-h') return { help: true };
    if (!allowed.has(flag)) throw new Error(`Unknown option ${flag}`);
    const family = ['--seed', '--seeds'].includes(flag) ? 'seeds' : ['--policy', '--policies'].includes(flag) ? 'policies' : flag;
    if (seen.has(family)) throw new Error(`Repeated option ${flag}`);
    seen.add(family);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    const integer = text => { if (!/^\d+$/.test(text)) throw new Error(`Expected an integer for ${flag}`); return Number(text); };
    if (flag === '--days') options.days = integer(value);
    else if (flag === '--seed' || flag === '--seeds') options.seeds = value.split(',').map(integer);
    else if (flag === '--policy' || flag === '--policies') options.policies = value.split(',');
    else if (flag === '--checkpoint') options.checkpointEvery = integer(value);
    else if (flag === '--stall-after') options.stallAfter = integer(value);
    else if (flag === '--site') options.site = value;
    else if (flag === '--out') options.directory = resolve(value);
    else options.saveFile = resolve(value);
  }
  if (new Set(options.seeds).size !== options.seeds.length || new Set(options.policies).size !== options.policies.length) throw new Error('Seeds and policies must not contain duplicates');
  if (options.seeds.length * options.policies.length > 64) throw new Error('At most 64 campaigns can run in one batch');
  for (const seed of options.seeds) for (const policy of options.policies) validateOptions({ ...options, seed, policy });
  return options;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.help) { console.log(help); return 0; }
  let save;
  if (options.saveFile) {
    save = JSON.parse(readFileSync(options.saveFile, 'utf8'));
    if (!save?.planet || !save?.chunkData || !save?.codes) throw new Error('Expected a native exported .planet save with planet, chunkData and codes');
  }
  const directory = options.directory || mkdtempSync(join(tmpdir(), 'gentown-campaign-'));
  if (options.directory) mkdirSync(directory, { recursive: false });
  const manifest = { ...options, directory, results: [] };
  if (save) writeFileSync(join(directory, 'input.planet'), JSON.stringify(save));
  writeFileSync(join(directory, 'batch.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Campaign output: ${directory}`);
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  try {
    for (const seed of options.seeds) for (const policy of options.policies) {
      if (controller.signal.aborted) break;
      const name = `seed-${seed}-${policy}`;
      const { report } = await runCampaign({ ...options, seed, policy, save,
        directory: join(directory, name), signal: controller.signal,
        onProgress: r => console.log(`${name}: ${r.turns}/${options.days} turns, day ${r.day}, population ${r.population}, ${(r.elapsedMs / 1000).toFixed(1)}s`) });
      manifest.results.push({ seed, policy, status: report.status, turns: report.turns,
        elapsedMs: report.elapsedMs, discoveries: report.milestones.length, firstExtinction: report.firstExtinction,
        longestQuietStretch: report.longestQuietStretch, unfinishedWork: report.waitingWork.length, stalledWork: report.stalledWork.length,
        population: report.final?.worlds.reduce((n, w) => n + w.population, 0), report: `${name}/report.json` });
      writeFileSync(join(directory, 'batch.json'), JSON.stringify(manifest, null, 2) + '\n');
      console.log(report.summary);
      // Yield to Node so Ctrl+C can preserve a finished batch and stop cleanly.
      await new Promise(resolve => setImmediate(resolve));
    }
  } finally { process.removeListener('SIGINT', interrupt); }
  writeFileSync(join(directory, 'batch.txt'), manifest.results.map(r => `Seed ${r.seed}, ${r.policy}: ${r.status}, ${r.turns} turns, ${r.population} people, ${r.discoveries} discoveries, longest quiet stretch ${r.longestQuietStretch} days, ${(r.elapsedMs / 1000).toFixed(2)}s`).join('\n') + '\n');
  return controller.signal.aborted ? 130 : manifest.results.every(r => r.status === 'passed') ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
