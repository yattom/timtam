import { describe, it, expect } from 'vitest';
import { sortGraspConfigs, GraspConfigItem } from './getConfigs';

describe('sortGraspConfigs', () => {
  it('DEFAULT設定を最初にソート', () => {
    const configs: GraspConfigItem[] = [
      { configId: 'a_123', name: 'custom', yaml: '', createdAt: 100, updatedAt: 100 },
      { configId: 'b_124', name: 'DEFAULT', yaml: '', createdAt: 200, updatedAt: 200 },
    ];

    const sorted = sortGraspConfigs(configs);

    expect(sorted[0].name).toBe('DEFAULT');
    expect(sorted[1].name).toBe('custom');
  });

  it('非DEFAULT設定をupdatedAt降順でソート', () => {
    const configs: GraspConfigItem[] = [
      { configId: 'a_123', name: 'old', yaml: '', createdAt: 100, updatedAt: 100 },
      { configId: 'b_124', name: 'new', yaml: '', createdAt: 200, updatedAt: 200 },
    ];

    const sorted = sortGraspConfigs(configs);

    expect(sorted[0].name).toBe('new');
    expect(sorted[1].name).toBe('old');
  });

  it('複数のDEFAULT設定は最新を最初に', () => {
    const configs: GraspConfigItem[] = [
      { configId: 'DEFAULT_123', name: 'DEFAULT', yaml: '', createdAt: 100, updatedAt: 100 },
      { configId: 'DEFAULT_124', name: 'DEFAULT', yaml: '', createdAt: 200, updatedAt: 200 },
      { configId: 'custom_125', name: 'custom', yaml: '', createdAt: 300, updatedAt: 300 },
    ];

    const sorted = sortGraspConfigs(configs);

    expect(sorted[0].configId).toBe('DEFAULT_124');
    expect(sorted[1].configId).toBe('DEFAULT_123');
    expect(sorted[2].name).toBe('custom');
  });

  it('"default"（小文字）はDEFAULTとして扱わない', () => {
    const configs: GraspConfigItem[] = [
      { configId: 'a_123', name: 'default', yaml: '', createdAt: 100, updatedAt: 200 },
      { configId: 'b_124', name: 'custom', yaml: '', createdAt: 200, updatedAt: 100 },
    ];

    const sorted = sortGraspConfigs(configs);

    // updatedAtでソート（DEFAULTとして扱わない）
    expect(sorted[0].name).toBe('default');
    expect(sorted[1].name).toBe('custom');
  });

  it('"DEFAULT-custom"はDEFAULTとして扱わない', () => {
    const configs: GraspConfigItem[] = [
      { configId: 'a_123', name: 'DEFAULT-custom', yaml: '', createdAt: 100, updatedAt: 200 },
      { configId: 'b_124', name: 'other', yaml: '', createdAt: 200, updatedAt: 100 },
    ];

    const sorted = sortGraspConfigs(configs);

    // updatedAtでソート（DEFAULTとして扱わない）
    expect(sorted[0].name).toBe('DEFAULT-custom');
    expect(sorted[1].name).toBe('other');
  });

  it('元の配列を変更しない（immutable）', () => {
    const configs: GraspConfigItem[] = [
      { configId: 'a_123', name: 'custom', yaml: '', createdAt: 100, updatedAt: 100 },
      { configId: 'b_124', name: 'DEFAULT', yaml: '', createdAt: 200, updatedAt: 200 },
    ];

    const original = [...configs];
    sortGraspConfigs(configs);

    expect(configs).toEqual(original);
  });

  it('空の配列を正しく処理', () => {
    const configs: GraspConfigItem[] = [];

    const sorted = sortGraspConfigs(configs);

    expect(sorted).toEqual([]);
  });

  it('DEFAULT設定のみの場合、updatedAt降順でソート', () => {
    const configs: GraspConfigItem[] = [
      { configId: 'DEFAULT_123', name: 'DEFAULT', yaml: '', createdAt: 100, updatedAt: 100 },
      { configId: 'DEFAULT_125', name: 'DEFAULT', yaml: '', createdAt: 300, updatedAt: 300 },
      { configId: 'DEFAULT_124', name: 'DEFAULT', yaml: '', createdAt: 200, updatedAt: 200 },
    ];

    const sorted = sortGraspConfigs(configs);

    expect(sorted[0].configId).toBe('DEFAULT_125');
    expect(sorted[1].configId).toBe('DEFAULT_124');
    expect(sorted[2].configId).toBe('DEFAULT_123');
  });
});
