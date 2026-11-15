// Operator -> logo file: every mapped file exists, is small, and cannot run or fetch anything; the plate markup.
import { test, expect } from 'bun:test';
import fs from 'node:fs';
import { LOGOS, logoUrl, logoPlate } from './logos.js';

const DIR = new URL('../../public/logos/', import.meta.url);

test('every operator with a logo maps to a clean, small SVG in web/public/logos', () => {
  expect(Object.keys(LOGOS).sort()).toEqual(['KAI', 'KAI-Commuter', 'LRT-Jabodebek', 'LRT-Jakarta', 'MRT-Jakarta', 'TransJakarta']);
  for (const [op, file] of Object.entries(LOGOS)) {
    const svg = fs.readFileSync(new URL(`${file}.svg`, DIR), 'utf8');
    expect(logoUrl(op)).toBe(`/logos/${file}.svg`);
    expect(svg.length).toBeLessThan(20_000);
    expect(svg).toMatch(/^<svg\b[^>]*\sviewBox="/);
    // nothing that runs, loads or embeds: no script, event handler, external link or url(), no editor metadata
    expect(svg).not.toMatch(/<script|<foreignObject|<image\b|<iframe|<!ENTITY|<!DOCTYPE|\son\w+\s*=|javascript:|@import|href="(?!#)|url\((?!#)|<metadata|inkscape:|sodipodi:/i);
  }
  expect(fs.readFileSync(new URL('SUMBER.md', DIR), 'utf8')).toContain('tidak berafiliasi');
});

test('an operator without a logo keeps its initials; the plate is hidden from screen readers but named', () => {
  expect(logoUrl('Toei')).toBe(null);
  expect(logoUrl('toString')).toBe(null);   // own keys only
  expect(logoPlate('Toei', 'Toei')).toBe('');
  const html = logoPlate('MRT-Jakarta', 'MRT Jakarta');
  expect(html).toContain('aria-hidden="true"');
  expect(html).toContain('src="/logos/mrt-jakarta.svg"');
  expect(html).toContain('alt="MRT Jakarta"');
  expect(html).toContain('tk-logo-row');
  expect(logoPlate('KAI', 'KAI "<x>"', 'sm')).toContain('alt="KAI &quot;&lt;x&gt;&quot;"');
});
