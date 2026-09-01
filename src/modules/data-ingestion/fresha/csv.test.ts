import { describe, expect, it } from 'vitest';
import { cell, headerIndex, parseCsvText } from './csv';

describe('parseCsvText', () => {
  it('splits a simple CSV into rows of cells', () => {
    expect(parseCsvText('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('handles quoted fields with embedded commas', () => {
    expect(parseCsvText('name,note\n"Smith, John",hello')).toEqual([
      ['name', 'note'],
      ['Smith, John', 'hello'],
    ]);
  });

  it('handles escaped quotes inside quoted fields', () => {
    expect(parseCsvText('note\n"she said ""hi"""')).toEqual([['note'], ['she said "hi"']]);
  });

  it('handles embedded newlines inside quoted fields', () => {
    expect(parseCsvText('note\n"line one\nline two"')).toEqual([['note'], ['line one\nline two']]);
  });

  it('normalizes CRLF line endings', () => {
    expect(parseCsvText('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('drops a fully blank trailing row from a trailing newline', () => {
    expect(parseCsvText('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('headerIndex + cell', () => {
  it('looks up columns by trimmed, case-insensitive name', () => {
    const rows = parseCsvText('Full Name , Email\nJane Doe,jane@example.com');
    const index = headerIndex(rows[0]!);
    expect(cell(rows[1]!, index, 'full name')).toBe('Jane Doe');
    expect(cell(rows[1]!, index, 'Email')).toBe('jane@example.com');
  });

  it('returns null for a missing column', () => {
    const rows = parseCsvText('a\n1');
    const index = headerIndex(rows[0]!);
    expect(cell(rows[1]!, index, 'b')).toBeNull();
  });

  it('returns null for a blank cell rather than an empty string', () => {
    const rows = parseCsvText('a,b\n1,');
    const index = headerIndex(rows[0]!);
    expect(cell(rows[1]!, index, 'b')).toBeNull();
  });
});
