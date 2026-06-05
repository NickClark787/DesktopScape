import { describe, expect, it } from 'vitest';
import { parseBankItemIds } from '@/utils/parseBankExport';

describe('parseBankItemIds', () => {
  it('parses the RuneLite tab-separated bank export, skipping the header', () => {
    const text = [
      'Item id\tItem name\tItem quantity',
      '9787\tSlayer cape(t)\t1',
      '11832\tBandos chestplate\t1',
    ].join('\n');
    expect(parseBankItemIds(text)).toEqual([9787, 11832]);
  });

  it('keeps the id as the first token even when the name contains digits', () => {
    // "Saradomin brew(4)" must not be misread — the id is the first column.
    expect(parseBankItemIds('6685\tSaradomin brew(4)\t10')).toEqual([6685]);
  });

  it('accepts comma- and whitespace-separated rows too', () => {
    expect(parseBankItemIds('9787,Slayer cape(t),1')).toEqual([9787]);
    expect(parseBankItemIds('11832 Bandos chestplate 1')).toEqual([11832]);
  });

  it('dedupes repeated ids and ignores blank / non-id lines', () => {
    const text = [
      '',
      'Item id\tItem name\tItem quantity',
      '4151\tAbyssal whip\t1',
      '   ',
      '4151\tAbyssal whip\t1',
      'just some text',
      '0\tNothing\t0',
      '-5\tBad\t1',
    ].join('\n');
    expect(parseBankItemIds(text)).toEqual([4151]);
  });

  it('handles a bare list of ids and CRLF line endings', () => {
    expect(parseBankItemIds('4151\r\n11832\r\n9787')).toEqual([4151, 11832, 9787]);
  });

  it('returns an empty array for empty / header-only input', () => {
    expect(parseBankItemIds('')).toEqual([]);
    expect(parseBankItemIds('Item id\tItem name\tItem quantity')).toEqual([]);
  });
});
