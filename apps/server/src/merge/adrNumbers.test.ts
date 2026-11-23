import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { adrClash, adrNumber, ADR_DIR, duplicateAdrNumbers } from './adrNumbers';

const repoAdrs = fileURLToPath(new URL('../../../../docs/adr', import.meta.url));

describe('ADR numbers', () => {
  it('reads the number of ADR files directly in docs/adr only', () => {
    expect(adrNumber('docs/adr/0033-a.md')).toBe('0033');
    expect(adrNumber('docs/adr/README.md')).toBeNull();
    expect(adrNumber('docs/adr/old/0033-a.md')).toBeNull();
    expect(adrNumber('docs/adr/0033-a.txt')).toBeNull();
    expect(adrNumber('notes/0033-a.md')).toBeNull();
  });

  it('finds numbers held by more than one file', () => {
    const paths = ['docs/adr/0033-a.md', 'docs/adr/0033-b.md', 'docs/adr/0034-c.md', 'docs/adr/README.md', 'docs/adr/old/0034-d.md', 'docs/adr/notes.md'];
    expect([...duplicateAdrNumbers(paths)]).toEqual([['0033', ['docs/adr/0033-a.md', 'docs/adr/0033-b.md']]]);
  });

  it('blames only a branch that adds the clashing ADR', () => {
    const base = ['docs/adr/0001-a.md', 'docs/adr/0035-b.md', 'docs/adr/0035-c.md'];
    expect(adrClash(base, [])).toBeNull();
    expect(adrClash([...base, 'docs/adr/0036-d.md'], ['docs/adr/0036-d.md'])).toBeNull();
    expect(adrClash([...base, 'docs/adr/0001-new.md'], ['docs/adr/0001-new.md'])).toBe(
      'docs/adr/0001-new.md takes ADR-0001, which docs/adr/0001-a.md already has on the base; renumber it to ADR-0036 and update its references ("ADR-0001" in docs and code).',
    );
  });

  it('names the other file when a branch adds two ADRs with one number', () => {
    const added = ['docs/adr/0002-x.md', 'docs/adr/0002-y.md'];
    expect(adrClash(['docs/adr/0001-a.md', ...added], added)).toMatch(/^docs\/adr\/0002-x\.md takes ADR-0002, which docs\/adr\/0002-y\.md takes too; renumber it to ADR-0003/);
  });

  it('this repository has no two ADRs with one number', () => {
    const files = readdirSync(repoAdrs).map((name) => `${ADR_DIR}/${name}`);
    expect(files.length).toBeGreaterThan(30);
    expect([...duplicateAdrNumbers(files)]).toEqual([]);
  });
});
