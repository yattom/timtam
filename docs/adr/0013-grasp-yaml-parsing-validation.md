# ADR 0013: Grasp YAML 設定のパースとバリデーション方式

- Status: Accepted
- Date: 2025-12-31
- Owners: やっとむ

## 背景 / Context

Grasp の設定を YAML ファイルで定義し、実行時にパース・バリデーションを行う必要がある。現在の `GraspDefinition` は比較的シンプルな構造だが、将来的にネストした複雑な型を持つ可能性がある。

バリデーション要件：
- 必須フィールドの存在チェック（nodeId, promptTemplate, intervalSec, outputHandler）
- 値の妥当性チェック（intervalSec が正の数、outputHandler が許可された値）
- **未定義パラメータの検出** - 設定ミスやタイポを早期発見するため

TypeScript のインターフェースは実行時に消えるため、許可されたフィールドのリストを別途管理する必要があり、二重管理（DRY 原則違反）の問題が生じる。

## 決定 / Decision

**現時点では手書きバリデーションを採用する。**

実装方針：
```typescript
const allowedKeys = new Set(['nodeId', 'promptTemplate', 'intervalSec', 'outputHandler', 'noteTag']);

for(const grasp of parsed.grasps) {
  // 未定義パラメータチェック
  const graspKeys = Object.keys(grasp);
  for(const key of graspKeys) {
    if(!allowedKeys.has(key)) {
      throw new Error(`Unknown parameter: ${key}`);
    }
  }
  // 以降、各フィールドのバリデーション
}
```

理由：
- 現時点では Grasp 定義の構造がシンプルで、手書きでも管理可能
- 追加の依存関係を導入するコストが見合わない
- バリデーションロジックが明示的で理解しやすい
- テストも十分に書けている

## 影響 / Consequences

### ポジティブ
- 依存関係が増えない（bundle size への影響なし）
- バリデーションロジックが明示的
- チームメンバー全員が理解しやすいコード

### ネガティブ
- `allowedKeys` と `GraspDefinition` インターフェースの二重管理
- フィールド追加時に両方を更新する必要がある（更新忘れのリスク）
- ネストした複雑な型が増えると、手書きバリデーションの保守性が低下

## 代替案 / Alternatives Considered

### Zod によるスキーマバリデーション（将来の選択肢）

[Zod](https://zod.dev/) を使用してスキーマ駆動のバリデーションを行う：

```typescript
import { z } from 'zod';

const graspDefinitionSchema = z.object({
  nodeId: z.string().min(1),
  promptTemplate: z.string().min(1),
  intervalSec: z.number().positive(),
  outputHandler: z.enum(['chat', 'note', 'both']),
  noteTag: z.string().optional(),
}).strict(); // 未定義キーを自動で拒否

export type GraspDefinition = z.infer<typeof graspDefinitionSchema>;

export function parseGraspGroupDefinition(yaml: string): GraspGroupDefinition {
  const parsed = YAML.load(yaml);
  return graspGroupDefinitionSchema.parse(parsed);
}
```

**メリット:**
- スキーマが唯一の真実の情報源（Single Source of Truth）
- 型定義とバリデーションの自動同期
- ネストした複雑な構造にも容易に対応
- 自動生成される詳細なエラーメッセージ
- `.strict()` で未定義キーを自動検出

**デメリット:**
- 新しい依存関係の追加（約 60KB gzipped）
- チーム全体での学習コスト
- 現時点ではオーバーエンジニアリング

**移行タイミング:**
- Grasp 定義が 10+ フィールドに増えた時
- ネストした型（オブジェクトの配列など）が複数登場した時
- バリデーションロジックの保守が困難になった時
- 他のコンポーネントでも同様のバリデーションが必要になった時

## 未決事項 / TBD

- Zod への移行タイミングの具体的な判断基準
- 他の設定ファイル（今後追加される可能性）のパース方式との整合性

## 参考 / References

- [Zod - TypeScript-first schema validation](https://zod.dev/)
- [TDD by Kent Beck](https://www.amazon.com/Test-Driven-Development-Kent-Beck/dp/0321146530) - テスト駆動でバリデーション実装
