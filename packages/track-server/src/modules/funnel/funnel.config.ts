import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { KNOWN_EVENTS } from '../../domain/events.js';
import { BadRequestError } from '../../domain/errors.js';

const funnelSchema = z.object({
  key: z.string().min(1).max(64),
  name: z.string().min(1).max(64),
  appId: z.string().min(1).max(64),
  env: z.string().max(16).optional(),
  steps: z.array(z.string().min(1).max(64)).min(2).max(10),
  windowMinutes: z.number().int().positive().max(1440).default(30),
});

const fileSchema = z.array(funnelSchema);

export type FunnelDef = z.infer<typeof funnelSchema>;

const DEFAULT_PATH = fileURLToPath(new URL('../../../config/funnels.yaml', import.meta.url));

export function loadFunnels(path?: string): FunnelDef[] {
  const target = path ?? DEFAULT_PATH;
  let raw: string;
  try {
    raw = readFileSync(target, 'utf8');
  } catch {
    throw new Error(`funnels config not found: ${target}`);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    throw new Error(`funnels config is not valid YAML: ${target} (${(error as Error).message})`);
  }

  const result = fileSchema.safeParse(parsed ?? []);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new Error(`funnels config invalid: ${detail}`);
  }

  // 事件名拼错会让漏斗恒为 0，启动期就失败，不要等到线上才发现
  const unknown = new Set<string>();
  for (const funnel of result.data) {
    for (const step of funnel.steps) {
      if (!KNOWN_EVENTS.includes(step)) unknown.add(step);
    }
  }
  if (unknown.size > 0) {
    throw new Error(`funnels config references unknown events: ${[...unknown].join(', ')}`);
  }

  const keys = new Set<string>();
  for (const funnel of result.data) {
    if (keys.has(funnel.key)) throw new Error(`duplicated funnel key: ${funnel.key}`);
    keys.add(funnel.key);
  }

  return result.data;
}

export function findFunnel(funnels: FunnelDef[], key: string | undefined): FunnelDef {
  if (!key) {
    const first = funnels[0];
    if (!first) throw new BadRequestError('no funnel configured');
    return first;
  }
  const found = funnels.find((item) => item.key === key);
  if (!found) throw new BadRequestError(`unknown funnel: ${key}`);
  return found;
}
