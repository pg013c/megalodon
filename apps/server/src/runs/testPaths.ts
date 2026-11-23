import { globToRegExp } from '../merge/git';

/**
 * The files a guarded step must not have changed (ADR-0034). `only`: the step writes tests, so
 * any file outside the test paths; `locked`: the tests are fixed, so any file inside them.
 */
export function testPathViolations(files: readonly string[], testPaths: readonly string[], mode: 'only' | 'locked'): string[] {
  const globs = testPaths.map(globToRegExp);
  const isTest = (file: string) => globs.some((glob) => glob.test(file));
  return files.filter((file) => (mode === 'locked' ? isTest(file) : !isTest(file)));
}
