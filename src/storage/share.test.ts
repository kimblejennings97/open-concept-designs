import { describe, expect, it } from 'vitest';
import { deserialize, serialize } from '../model/design';
import { sampleHouse } from '../model/samples';
import { decodeDesign, encodeDesign, shareUrl, sharedCode } from './share';

describe('share links', () => {
  it('round-trips a design through a compact URL', async () => {
    const d = sampleHouse();
    const url = await shareUrl(serialize(d), 'https://example.com/open-concept-designs/');
    const code = sharedCode(new URL(url).hash)!;
    expect(code).toBeTruthy();
    expect(url.length).toBeLessThan(8000);
    const back = deserialize(await decodeDesign(code));
    expect(serialize(back)).toEqual(serialize(d));
  });

  it('ignores other hashes', async () => {
    expect(sharedCode('#hello')).toBeNull();
    expect(await encodeDesign(serialize(sampleHouse()))).toMatch(/^[\w-]+$/);
  });
});
