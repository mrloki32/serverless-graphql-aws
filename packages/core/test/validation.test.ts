import { describe, expect, it } from 'vitest';
import { parseCreateTaskInput, parseUpdateTaskInput, ValidationError } from '../src';

const ID = '2f1c1a8e-4c1b-4a43-9d8a-0b6f6f0f5d11';

describe('parseCreateTaskInput', () => {
  it('trims and defaults', () => {
    expect(parseCreateTaskInput({ title: '  Write docs  ' })).toEqual({
      title: 'Write docs',
      description: null,
      status: undefined,
    });
  });

  it('rejects empty titles and unknown fields', () => {
    expect(() => parseCreateTaskInput({ title: '   ' })).toThrow(ValidationError);
    expect(() => parseCreateTaskInput({ title: 'x', owner: 'someone-else' })).toThrow(ValidationError);
  });

  it('rejects invalid status', () => {
    expect(() => parseCreateTaskInput({ title: 'x', status: 'BLOCKED' })).toThrow(/status/);
  });
});

describe('parseUpdateTaskInput', () => {
  it('requires at least one field', () => {
    expect(() => parseUpdateTaskInput({ id: ID })).toThrow(/at least one/);
  });

  it('distinguishes clearing description from leaving it unchanged', () => {
    expect(parseUpdateTaskInput({ id: ID, description: null }).description).toBeNull();
    expect(parseUpdateTaskInput({ id: ID, status: 'DONE' }).description).toBeUndefined();
  });

  it('requires a uuid id', () => {
    expect(() => parseUpdateTaskInput({ id: '1; DROP TABLE tasks', status: 'DONE' })).toThrow(/UUID/);
  });
});
