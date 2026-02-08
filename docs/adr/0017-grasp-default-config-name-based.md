# ADR 0017: Grasp設定のデフォルト判定をnameフィールドに統一

- Status: Accepted
- Date: 2026-02-02
- Owners: やっとむ

## 背景 / Context

Issue #125 で発覚した問題：

Grasp設定のデフォルト判定に2つの異なるメカニズムが存在し、不整合が発生していた。

### 既存の2つのメカニズム

1. **UI/Admin API** (`services/grasp-config/getConfigs.ts`)
   - `isDefault` boolean フラグを使用してソート
   - データベース（DynamoDB）に `isDefault` フィールドを保存
   - 設定一覧の表示順序を制御（デフォルトを最上部に表示）

2. **Runtime/Orchestrator** (`services/orchestrator/graspConfigLoader.ts`)
   - `FilterExpression: 'begins_with(configId, :prefix)'` で "DEFAULT-" プレフィックスをチェック
   - 会議開始時にデフォルト設定を自動適用するために使用
   - 該当する設定がない場合、ハードコードされたデフォルトYAMLを使用

### 問題の詳細

**configId は自動生成される**:
- 形式: `{sanitizedName}_{timestamp}`
- 例: ユーザーが "DEFAULT" という名前で設定を作成 → `DEFAULT_20260125_003500` になる
- この configId は "DEFAULT-" (ハイフン) で始まらないため、orchestrator の検索に引っかからない

**isDefault フラグの問題**:
- データベースには保存されるが、実行時のデフォルト選択には一切使用されない
- UI でのソートにのみ使用されている
- ユーザーが手動で `isDefault: true` を設定しても、会議開始時のデフォルト適用には影響しない

**結果**:
- ユーザーがデフォルト設定を作成する正規の方法が存在しない
- UI とランタイムで異なるロジックが動作し、混乱の元となる
- システムの動作が予測不可能

## 決定 / Decision

**`name === "DEFAULT"` による完全一致で判定する**

### 実装内容

1. **デフォルト判定ロジックの統一**
   - orchestrator の `getDefaultGraspConfig()` を修正
   - DynamoDB クエリで `FilterExpression: '#name = :defaultName'` を使用
   - プレフィックスマッチではなく、完全一致（exact match）

2. **isDefault フィールドの完全削除**
   - データベーススキーマから削除（DynamoDB なので明示的な削除は不要）
   - すべてのコードから `isDefault` への参照を削除：
     - `services/grasp-config/getConfigs.ts`
     - `services/grasp-config/savePreset.ts`
     - ~~`web/timtam-web/src/api.ts`~~ (timtam-web 削除済み 2026-02-08)
     - ~~`web/timtam-web/src/GraspConfigPanel.tsx`~~ (timtam-web 削除済み 2026-02-08)

3. **ソートロジックの変更**
   - `getConfigs.ts` で `name === 'DEFAULT'` による判定に変更
   - DEFAULT 設定を最上部に配置、その他は `updatedAt` 降順でソート
   - ソートロジックを純粋関数 `sortGraspConfigs()` として抽出し、ユニットテスト可能にする

4. **UI 表示の変更**
   - "(デフォルト)" ラベルの判定を `p.name === 'DEFAULT'` に変更
   - デフォルト設定の検索を `find(p => p.name === 'DEFAULT')` に変更

### 技術的な詳細

**DynamoDB クエリの変更**:
```typescript
// 変更前
FilterExpression: 'begins_with(configId, :prefix)',
ExpressionAttributeValues: {
  ':prefix': 'DEFAULT-',
}

// 変更後
FilterExpression: '#name = :defaultName',
ExpressionAttributeNames: {
  '#name': 'name',  // DynamoDB 予約語対策
},
ExpressionAttributeValues: {
  ':defaultName': 'DEFAULT',
}
```

**複数の DEFAULT 設定がある場合**:
- configId の降順ソート（タイムスタンプが含まれるため、最新のものが選ばれる）
- 最新の DEFAULT 設定が使用される

## 影響 / Consequences

### ポジティブな影響

1. **シンプルで理解しやすい**
   - 1つの判定ロジックで統一（Single Source of Truth）
   - ユーザーは "DEFAULT" という名前で設定を作ればよいだけ

2. **コードの簡素化**
   - `isDefault` フィールドの管理が不要
   - ソート、フィルタリング、表示ロジックが一貫する

3. **予測可能な動作**
   - UI で見える情報と、実際の動作が一致する
   - デフォルト設定の作成・選択が明確

4. **保守性の向上**
   - 判定ロジックが1箇所に集約される
   - 将来の拡張（管理者限定、ユーザー毎のデフォルト等）が容易

### ネガティブな影響

1. **Magic String**
   - "DEFAULT" という文字列が特別な意味を持つ
   - 定数化も検討したが、データベースの値なので効果は限定的

2. **複数の DEFAULT 設定の作成が可能**
   - ユーザーが誤って複数の "DEFAULT" 設定を作成できる
   - システムは最新のものを選ぶが、混乱の元
   - 現状では防止策なし（将来の改善項目）

3. **大文字小文字の区別**
   - "DEFAULT" (全大文字) のみが特別扱い
   - "default", "Default" は通常の設定として扱われる
   - ユーザーへの説明が必要

4. **既存データのクリーンアップ**
   - 既存の `isDefault` フィールドを持つデータは無視される
   - データパージを推奨（マイグレーションは不要）

### 後方互換性

- **DynamoDB は schemaless**: `isDefault` フィールドが残っていてもエラーにならない
- **新コードは `isDefault` を無視**: 読み取り処理に含めない
- **動作に影響なし**: データパージなしでも新コードは正常に動作する

## 代替案 / Alternatives Considered

### 代替案A: isDefault フラグを使い続ける

**内容**:
- 現在の `isDefault` フラグを維持
- orchestrator でも `isDefault` フラグを参照するように変更

**メリット**:
- boolean で明示的
- 意図が明確（特定の設定を「デフォルト」としてマーク）

**デメリット**:
- configId との不整合は解決しない
- フラグの同期管理が必要（複数の設定に `isDefault: true` が設定された場合の処理）
- 根本的な問題（ユーザーがデフォルト設定を作成できない）は解決しない

**却下理由**:
現状の問題を解決せず、複雑さを増すだけ

### 代替案B: configId のプレフィックスを修正（"DEFAULT-" → "DEFAULT_"）

**内容**:
- orchestrator のクエリを `begins_with(configId, 'DEFAULT_')` に変更
- 自動生成される configId（`DEFAULT_{timestamp}`）にマッチさせる

**メリット**:
- 既存のロジックを最小限の変更で活かせる

**デメリット**:
- configId の内部形式に依存（fragile）
- configId 生成ロジックの変更に弱い
- 将来の拡張性が低い（ユーザー毎のデフォルト等）
- "DEFAULT_custom" のような名前も一致してしまう

**却下理由**:
内部実装詳細に依存しすぎ、将来の保守性が低い

### 代替案C: name のプレフィックスマッチ（begins_with）

**内容**:
- `FilterExpression: 'begins_with(#name, :prefix)'` で "DEFAULT" プレフィックスをチェック
- "DEFAULT-custom", "DEFAULT-special" なども該当

**メリット**:
- 派生設定を作れる柔軟性

**デメリット**:
- エッジケースが多い
  - "DEFAULT2" も一致してしまう
  - "DEFAULTCONFIG" も一致してしまう
- ユーザーが意図しない設定がデフォルトになる可能性
- 複雑さが増す（どの設定がデフォルトか分かりにくい）

**却下理由**:
エッジケースの管理が困難、予期しない動作を招く

### 代替案D: 専用の isDefault フラグ + name 検証

**内容**:
- `isDefault` フラグを保持
- ただし、`name === 'DEFAULT'` の場合のみ `isDefault: true` を許可
- 保存時にバリデーションで強制

**メリット**:
- 明示的なフラグで意図が明確

**デメリット**:
- 2つのフィールドの同期が必要（DRY 原則に反する）
- 不整合のリスク（どちらを信頼すべきか）
- コードが複雑化

**却下理由**:
Single Source of Truth 原則に反し、保守性が低い

## 未決事項 / TBD

### 1. 複数の DEFAULT 設定の防止

**現状**:
- ユーザーは複数の "DEFAULT" 設定を作成可能
- システムは configId 降順ソートで最新のものを選択（動作は予測可能）

**将来の改善案**:
- **Phase 1**: ログに警告を出力（運用で気づけるようにする）
- **Phase 2**: UI で警告表示（"DEFAULT" という名前の設定が既に存在する場合）
- **Phase 3**: API でバリデーション（"DEFAULT" 設定の重複を禁止）

### 2. 大文字小文字の扱い

**現状**:
- 完全一致なので、"DEFAULT" (全大文字) のみが特別扱い
- "default", "Default" は通常の設定

**将来の改善案**:
- 名前の正規化処理（保存時に大文字に変換）
- UI でのガイダンス（"DEFAULT" を推奨）
- プリセット選択肢に "DEFAULT" を提供

### 3. 将来の拡張

**検討中の機能**:
- **管理者専用デフォルト**: 管理者のみがデフォルト設定を作成可能
- **ユーザー毎のデフォルト**: 各ユーザーが自分のデフォルト設定を持てる
- **組織毎のデフォルト**: 複数の組織で異なるデフォルトを使用
- **デフォルトの優先順位**: ユーザー > 組織 > グローバル

**設計上の考慮点**:
- 現在の設計（name ベース）は将来の拡張に対応しやすい
- 例: `name === 'DEFAULT' OR name === 'DEFAULT:user:{userId}'` のようなパターンマッチに拡張可能

### 4. UI での DEFAULT 名の推奨

**検討事項**:
- プリセット選択ドロップダウンに "DEFAULT" を常に表示
- 新規作成時に "DEFAULT" を提案（初めてデフォルトを作る場合）
- ドキュメントでデフォルト設定の作成方法を明記

## 参考 / References

### 関連 Issue
- GitHub Issue #125: Unify Grasp configuration default detection logic

### 関連ファイル
- `services/orchestrator/graspConfigLoader.ts` (lines 109-166): Runtime でのデフォルト設定取得
- `services/grasp-config/getConfigs.ts` (lines 23-38): 設定一覧取得とソート
- `services/grasp-config/savePreset.ts` (lines 15, 20, 75): 設定保存
- `services/grasp-config/saveConfig.ts`: configId 生成ロジック
- ~~`web/timtam-web/src/api.ts`~~ (timtam-web 削除済み 2026-02-08)
- ~~`web/timtam-web/src/GraspConfigPanel.tsx`~~ (timtam-web 削除済み 2026-02-08)

### 関連 ADR
- なし（Grasp 設定管理に関する初めての ADR）

### テストファイル
- `services/grasp-config/getConfigs.test.ts` (新規作成): ソートロジックのユニットテスト
- `e2e/tests/grasp-config-default.spec.ts` (新規作成推奨): DEFAULT 設定の E2E テスト
- 既存: `e2e/tests/grasp-config-uc01.spec.ts` through `uc05.spec.ts`

### ドキュメント
- `docs/grasp-config.md`: Grasp 設定の YAML フォーマット
- `README.md`: プロジェクト全体のドキュメント（更新予定）
