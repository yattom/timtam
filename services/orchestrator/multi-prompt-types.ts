/**
 * マルチプロンプトオーケストレーション用の型定義
 */

/**
 * プロンプトのトリガー設定
 */
export type PromptTrigger =
  | { type: 'every' } // 毎回実行
  | { type: 'interval'; intervalMs: number } // 定期実行
  | { type: 'threshold'; counter: string; value: number } // カウンター閾値
  | { type: 'dependency'; dependsOn: string[] }; // 他プロンプトの実行後

/**
 * プロンプト出力先
 */
export type PromptOutputType = 'intervention' | 'memo' | 'both';

/**
 * 単一プロンプトの設定
 */
export interface PromptConfig {
  id: string;
  name: string;
  promptText: string;
  trigger: PromptTrigger;
  stateful: boolean; // メモを保持するか
  outputTo: PromptOutputType;
  cooldownMs?: number; // このプロンプト専用のクールダウン
  maxTokens?: number;
  temperature?: number;
}

/**
 * オーケストレーター全体の設定
 */
export interface OrchestratorConfig {
  version: string;
  prompts: PromptConfig[];
  globalSettings: {
    windowLines: number;
    defaultCooldownMs: number;
    bedrockRegion?: string;
    bedrockModelId?: string;
  };
}

/**
 * プロンプトの実行状態
 */
export interface PromptState {
  promptId: string;
  memo: string; // statefulな場合のメモ
  lastExecutedAt: number;
  executionCount: number;
  counters: Record<string, number>; // カウンター
}

/**
 * プロンプト実行結果
 */
export interface PromptExecutionResult {
  promptId: string;
  timestamp: number;
  output: string;
  shouldIntervene?: boolean;
  updateMemo?: string; // メモの更新内容
  updateCounters?: Record<string, number>; // カウンターの更新
}

/**
 * LLMレスポンスの期待フォーマット
 */
export interface LLMResponse {
  should_intervene?: boolean;
  reason?: string;
  message?: string;
  memo?: string; // statefulな場合のメモ更新
  counters?: Record<string, number>; // カウンター更新
}
