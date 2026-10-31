/**
 * Bridge between Next.js and the Python ML model.
 *
 *  1. If a recent forecast file exists (< 1 hour old) -> use it (fast).
 *  2. Otherwise run `python ml/predict.py` (loads the saved model, writes a fresh file).
 *  3. If Python is unavailable but an old file exists -> use the old one.
 *  4. Otherwise -> { available: false } and the UI shows "run npm run ml:train".
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Forecast } from '@/lib/types';

const ROOT = process.cwd();
const FILE = path.join(ROOT, 'ml', 'model', 'forecast_latest.json');
const FRESH_MS = 60 * 60 * 1000;

async function readFileForecast(): Promise<Forecast | null> {
  try { return { available: true, ...JSON.parse(await readFile(FILE, 'utf8')) }; } catch { return null; }
}

function runPython(): Promise<boolean> {
  const py = process.env.PYTHON_BIN ?? '.venv/bin/python';
  return new Promise((resolve) => {
    execFile(path.resolve(ROOT, py), [path.join(ROOT, 'ml', 'predict.py'), '--out', FILE], { timeout: 20_000 }, (err) => resolve(!err));
  });
}

export async function getForecast(stallId?: number): Promise<Forecast> {
  let f = await readFileForecast();
  const fresh = f?.generated_at && Date.now() - new Date(f.generated_at).getTime() < FRESH_MS;
  if (!fresh) {
    if (await runPython()) f = await readFileForecast();
  }
  if (!f) return { available: false, stalls: [], note: 'No forecast yet. Run: npm run ml:data && npm run ml:train' };
  return stallId ? { ...f, stalls: f.stalls.filter((s) => s.stall_id === stallId) } : f;
}
