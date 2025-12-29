# Grasp 設定ガイド

## 概要

Grasp は、会議の発話ストリームを監視し、LLMを使って判断・介入を行う基本単位です。各 Grasp は独立したプロンプト、実行間隔、出力先を持ち、YAML形式で設定できます。

## YAML フォーマット

### 基本構造

```yaml
# グローバル設定（オプション）
global:
  llm:
    modelId: "anthropic.claude-haiku-4.5"
    region: "us-east-1"
  defaults:
    cooldownMs: 30000

# Grasp の定義
grasps:
  - nodeId: "grasp-id"
    promptTemplate: |
      プロンプトのテンプレート
      {{INPUT:latest5}}
    cooldownMs: 20000
    outputHandler: "chat"
    noteTag: "optional-tag"
```

### フィールド説明

#### global (オプション)

グローバル設定セクション。すべての Grasp に共通する設定を定義します。

- `llm.modelId`: 使用する Bedrock モデルID
- `llm.region`: Bedrock のリージョン
- `defaults.cooldownMs`: デフォルトの実行間隔（ミリ秒）

#### grasps (必須)

Grasp の定義リスト。各 Grasp には以下のフィールドがあります:

- **nodeId** (string, 必須): Grasp の一意識別子
- **promptTemplate** (string, 必須): LLM に送るプロンプトのテンプレート
  - `{{INPUT}}`, `{{INPUT:latest5}}`, `{{INPUT:past30m}}` などの修飾子で入力範囲を指定できます（詳細は「テンプレート変数」セクションを参照）
- **cooldownMs** (number, 必須): 実行間隔（ミリ秒）
- **outputHandler** (string, 必須): 出力先
  - `"chat"`: チャットに投稿
  - `"note"`: ノートブックに記録
  - `"both"`: 両方
- **noteTag** (string, オプション): `note` または `both` の場合、このタグでメモを保存

## テンプレート変数

promptTemplate 内で使用できる変数:

### `{{INPUT}}`

WindowBuffer から取得した入力テキスト（発話履歴）。各行は `[時刻] 発話内容` の形式。

#### 基本形

```yaml
promptTemplate: |
  以下は会議の直近発話です。
  ---
  {{INPUT}}
```

修飾子なしの `{{INPUT}}` はすべての発話を取得します。

#### INPUT 修飾子

入力範囲を明示的に指定できます：

```yaml
{{INPUT:all}}          # すべての発話
{{INPUT:latest5}}      # 最新5行
{{INPUT:latest10}}     # 最新10行
{{INPUT:past30m}}      # 過去30分間の発話
{{INPUT:past1h}}       # 過去1時間の発話
{{INPUT:past2h}}       # 過去2時間の発話
```

**時間指定のフォーマット:**
- `m` = 分 (minutes)
- `h` = 時間 (hours)
- 例: `5m`, `30m`, `90m`, `1h`, `2h`

**デフォルト動作:**
- 修飾子なしの `{{INPUT}}` はすべての発話を取得
- 特定の範囲が必要な場合は修飾子を使用（例: `{{INPUT:latest5}}`, `{{INPUT:past30m}}`）

**使用例:**

```yaml
# 例: 最新5行だけを見る
promptTemplate: |
  直近の発話を確認してください。
  ---
  {{INPUT:latest5}}

# 例: 過去30分の流れを見る
promptTemplate: |
  過去30分の会議の流れを整理してください。
  ---
  {{INPUT:past30m}}

# 例: すべての発話を要約
promptTemplate: |
  会議全体を要約してください。
  ---
  {{INPUT:all}}
```

### `{{SYSTEM_PROMPT}}`

動的に設定されるシステムプロンプト（CURRENT_PROMPT）。API または SQS 経由で変更可能。

```yaml
promptTemplate: |
  以下は会議の直近発話です。
  {{SYSTEM_PROMPT}}
  ---
  {{INPUT}}
```

### `{{NOTES:tag}}`

指定したタグのすべてのノートを取得。

```yaml
promptTemplate: |
  これまでの観察メモ:
  {{NOTES:participant-mood}}
```

### `{{NOTES:tag:latest1}}`

指定したタグの最新1件のノートを取得。

```yaml
promptTemplate: |
  最新の雰囲気:
  {{NOTES:participant-mood:latest1}}
```

### `{{NOTES:tag:latest3}}`

指定したタグの最新3件のノートを取得（数字は任意）。

```yaml
promptTemplate: |
  最近の雰囲気の変化:
  {{NOTES:participant-mood:latest3}}
```

### `{{NOTES:tag:all}}`

指定したタグのすべてのノートを取得（明示的に全件指定）。

```yaml
promptTemplate: |
  すべての観察メモ:
  {{NOTES:participant-mood:all}}
```

## レスポンス形式の自動追加

システムは自動的に以下の形式指定を promptTemplate の最後に追加します:

```
次のJSON形式だけを厳密に返してください:
{"should_intervene": boolean, "reason": string, "message": string}
```

**ユーザーは promptTemplate にこの形式指定を含める必要はありません。** タスク固有のプロンプト内容のみを記述してください。

## 設定例

### 例1: 基本的な介入判断

```yaml
grasps:
  - nodeId: "judge"
    promptTemplate: |
      以下は会議の直近確定発話です。
      {{SYSTEM_PROMPT}}

      介入が必要かを判断してください。
      ---
      {{INPUT:latest5}}
    cooldownMs: 20000
    outputHandler: "chat"
```

### 例2: 会議の流れを整理

```yaml
grasps:
  - nodeId: "tone-observer"
    promptTemplate: |
      以下は会議の確定発話です。
      ここまでの会議の流れを整理してください。
      ---
      {{INPUT:all}}
    cooldownMs: 60000
    outputHandler: "chat"
```

### 例3: 雰囲気を観察してノートに記録

```yaml
grasps:
  - nodeId: "mood-observer"
    promptTemplate: |
      以下は会議の直近確定発話です。
      参加者の雰囲気や感情を観察してください。
      例えば: 活発、落ち着いている、緊張している、議論が白熱している、など。

      観察理由と雰囲気の簡潔な説明を返してください。
      ---
      {{INPUT:latest5}}
    cooldownMs: 30000
    outputHandler: "note"
    noteTag: "participant-mood"
```

### 例4: ノートを参照して介入判断

```yaml
grasps:
  - nodeId: "mood-based-intervention"
    promptTemplate: |
      以下は会議の直近確定発話です。
      これまでの雰囲気観察を踏まえて、必要に応じて会議の進行をサポートしてください。

      【これまでの雰囲気観察】
      {{NOTES:participant-mood:latest3}}

      介入が必要かを判断してください。
      ---
      {{INPUT:latest5}}
    cooldownMs: 45000
    outputHandler: "chat"
```

### 例5: ノートのみを使った要約生成

```yaml
grasps:
  - nodeId: "summary-from-notes"
    promptTemplate: |
      これまでの観察メモをもとに、会議全体のサマリーを作成してください。

      【雰囲気の変化】
      {{NOTES:participant-mood:all}}

      【トピックの推移】
      {{NOTES:topic-summary:all}}

      会議のサマリーを返してください。
      # 注: {{INPUT}} を使わない場合、入力発話は含まれません
    cooldownMs: 120000
    outputHandler: "chat"
```

### 例6: グローバル設定を使った完全な設定

```yaml
global:
  llm:
    modelId: "anthropic.claude-sonnet-4.5"
    region: "us-east-1"
  defaults:
    cooldownMs: 30000

grasps:
  - nodeId: "judge"
    promptTemplate: |
      以下は会議の直近確定発話です。
      {{SYSTEM_PROMPT}}

      介入が必要かを判断してください。
      ---
      {{INPUT:latest5}}
    cooldownMs: 20000  # グローバルのデフォルトを上書き
    outputHandler: "chat"

  - nodeId: "mood-observer"
    promptTemplate: |
      以下は会議の直近確定発話です。
      参加者の雰囲気や感情を観察してください。
      ---
      {{INPUT:latest10}}
    # cooldownMs はグローバルのデフォルトを使用
    outputHandler: "note"
    noteTag: "participant-mood"
```

## 実装上の注意

### クールダウンとキューイング

- 各 Grasp は個別の `cooldownMs` を持ち、この間隔で実行されます
- グローバルクールダウン（2秒）も存在し、すべての Grasp 実行間に適用されます
- 複数の Grasp が同時に実行可能になった場合、キューに追加され順次実行されます

### ノートの保存と取得

- `outputHandler: "note"` または `"both"` の場合、LLM の応答が Notebook にメモとして保存されます
- メモには `tag`, `content`, `timestamp`, `createdBy` が含まれます
- 他の Grasp は `{{NOTES:tag:...}}` 構文でこれらのメモを参照できます

### 入力テキストの形式

`{{INPUT}}` で取得されるテキストは以下の形式:

```
[14:30:45] こんにちは、今日のミーティングを始めます
[14:31:02] よろしくお願いします
[14:31:15] 議題は新機能の設計についてです
```

各行に時刻が付与されるため、時系列を考慮した判断が可能です。

## 今後の拡張

将来的に以下の機能が追加される可能性があります:

- カスタムレスポンス形式のサポート（`responseFormat` フィールド）
- 条件付き実行（特定の条件下でのみ Grasp を実行）
- Grasp 間の依存関係管理
- 動的なプロンプト変数の追加
