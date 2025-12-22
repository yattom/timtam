import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import {
  OrchestratorConfig,
  PromptConfig,
  PromptState,
  PromptExecutionResult,
  LLMResponse,
} from './multi-prompt-types';

/**
 * マルチプロンプトエンジン
 * 複数のLLMプロンプトを管理し、連携させて実行する
 */
export class MultiPromptEngine {
  private bedrock: BedrockRuntimeClient;
  private config: OrchestratorConfig;
  private states: Map<string, PromptState>;

  constructor(config: OrchestratorConfig, bedrockRegion?: string) {
    this.config = config;
    this.bedrock = new BedrockRuntimeClient({
      region: bedrockRegion || config.globalSettings.bedrockRegion || 'us-east-1',
    });
    this.states = new Map();

    // 各プロンプトの初期状態を作成
    for (const prompt of config.prompts) {
      this.states.set(prompt.id, {
        promptId: prompt.id,
        memo: '',
        lastExecutedAt: 0,
        executionCount: 0,
        counters: {},
      });
    }
  }

  /**
   * 新しい発話に対してプロンプトを評価・実行
   */
  async processTranscript(
    windowText: string,
    meetingId: string
  ): Promise<PromptExecutionResult[]> {
    const results: PromptExecutionResult[] = [];
    const now = Date.now();

    // 各プロンプトを評価
    for (const promptConfig of this.config.prompts) {
      const state = this.states.get(promptConfig.id)!;

      // トリガー条件をチェック
      if (!this.shouldExecute(promptConfig, state, now)) {
        continue;
      }

      try {
        const result = await this.executePrompt(
          promptConfig,
          state,
          windowText,
          meetingId
        );
        results.push(result);

        // 状態を更新
        this.updateState(promptConfig.id, result, now);
      } catch (error) {
        console.error(
          JSON.stringify({
            type: 'multi-prompt.execution.error',
            promptId: promptConfig.id,
            error: (error as any)?.message || String(error),
            ts: now,
          })
        );
      }
    }

    return results;
  }

  /**
   * プロンプトを実行すべきかチェック
   */
  private shouldExecute(
    prompt: PromptConfig,
    state: PromptState,
    now: number
  ): boolean {
    // クールダウン中かチェック
    const cooldown = prompt.cooldownMs ?? this.config.globalSettings.defaultCooldownMs;
    if (now - state.lastExecutedAt < cooldown) {
      return false;
    }

    const trigger = prompt.trigger;

    switch (trigger.type) {
      case 'every':
        return true;

      case 'interval':
        return now - state.lastExecutedAt >= trigger.intervalMs;

      case 'threshold': {
        const counterValue = state.counters[trigger.counter] || 0;
        return counterValue >= trigger.value;
      }

      case 'dependency': {
        // 依存プロンプトがすべて実行済みかチェック
        return trigger.dependsOn.every((depId) => {
          const depState = this.states.get(depId);
          return depState && depState.executionCount > 0;
        });
      }

      default:
        return false;
    }
  }

  /**
   * 単一プロンプトを実行
   */
  private async executePrompt(
    prompt: PromptConfig,
    state: PromptState,
    windowText: string,
    meetingId: string
  ): Promise<PromptExecutionResult> {
    // プロンプトテキストを構築
    const fullPrompt = this.buildPromptText(prompt, state, windowText);

    // LLM呼び出し
    const llmResponse = await this.invokeLLM(
      fullPrompt,
      prompt.maxTokens || 500,
      prompt.temperature || 0.2
    );

    // 結果を構造化
    return {
      promptId: prompt.id,
      timestamp: Date.now(),
      output: llmResponse.message || '',
      shouldIntervene: llmResponse.should_intervene,
      updateMemo: llmResponse.memo,
      updateCounters: llmResponse.counters,
    };
  }

  /**
   * プロンプトテキストを構築
   */
  private buildPromptText(
    prompt: PromptConfig,
    state: PromptState,
    windowText: string
  ): string {
    let fullPrompt = prompt.promptText;

    // statefulな場合はメモを含める
    if (prompt.stateful && state.memo) {
      fullPrompt += `\n\n【これまでのメモ】\n${state.memo}`;
    }

    // カウンター情報を含める
    if (Object.keys(state.counters).length > 0) {
      fullPrompt += `\n\n【カウンター】\n${JSON.stringify(state.counters, null, 2)}`;
    }

    // 会議の発話内容を追加
    fullPrompt += `\n\n【会議の直近発話】\n${windowText}`;

    // 期待するレスポンス形式を指示
    fullPrompt += `\n\n次のJSON形式で厳密に返してください:\n`;

    const fields: string[] = [];
    if (prompt.outputTo === 'intervention' || prompt.outputTo === 'both') {
      fields.push('"should_intervene": boolean');
      fields.push('"reason": string');
      fields.push('"message": string');
    }
    if (prompt.stateful) {
      fields.push('"memo": string // 更新後のメモ全体');
    }
    if (prompt.trigger.type === 'threshold') {
      fields.push('"counters": { "counter_name": number }');
    }

    fullPrompt += `{${fields.join(', ')}}`;

    return fullPrompt;
  }

  /**
   * LLMを呼び出し
   */
  private async invokeLLM(
    prompt: string,
    maxTokens: number,
    temperature: number
  ): Promise<LLMResponse> {
    const modelId = this.config.globalSettings.bedrockModelId || 'anthropic.claude-haiku-4.5';

    const payload: any = {
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      max_tokens: maxTokens,
      temperature,
    };

    if (modelId.includes('anthropic')) {
      payload.anthropic_version = 'bedrock-2023-05-31';
    }

    const req: any = {
      body: JSON.stringify(payload),
      contentType: 'application/json',
      accept: 'application/json',
      modelId,
    };

    const res = await this.bedrock.send(new InvokeModelCommand(req));
    const txt = new TextDecoder().decode(res.body as any);

    try {
      const parsed = JSON.parse(txt);

      // Anthropic形式のレスポンスを処理
      if (parsed.content && Array.isArray(parsed.content)) {
        let embedded = parsed.content[0]?.text;
        if (typeof embedded === 'string') {
          // マークダウンコードブロックを除去
          embedded = embedded
            .replace(/^```json\s*\n?/i, '')
            .replace(/\n?```\s*$/i, '')
            .trim();
          return JSON.parse(embedded) as LLMResponse;
        }
      }

      // 直接JSONとして解釈
      return parsed as LLMResponse;
    } catch (error) {
      console.warn('LLM response parse failed', (error as any)?.message, txt);
      return {
        should_intervene: false,
        message: txt,
      };
    }
  }

  /**
   * プロンプト状態を更新
   */
  private updateState(
    promptId: string,
    result: PromptExecutionResult,
    timestamp: number
  ): void {
    const state = this.states.get(promptId);
    if (!state) return;

    state.lastExecutedAt = timestamp;
    state.executionCount++;

    if (result.updateMemo !== undefined) {
      state.memo = result.updateMemo;
    }

    if (result.updateCounters) {
      state.counters = { ...state.counters, ...result.updateCounters };
    }
  }

  /**
   * 特定プロンプトの状態を取得
   */
  getState(promptId: string): PromptState | undefined {
    return this.states.get(promptId);
  }

  /**
   * 全プロンプトの状態を取得
   */
  getAllStates(): Map<string, PromptState> {
    return new Map(this.states);
  }

  /**
   * 設定を更新
   */
  updateConfig(newConfig: OrchestratorConfig): void {
    this.config = newConfig;

    // 新しいプロンプトの状態を初期化
    for (const prompt of newConfig.prompts) {
      if (!this.states.has(prompt.id)) {
        this.states.set(prompt.id, {
          promptId: prompt.id,
          memo: '',
          lastExecutedAt: 0,
          executionCount: 0,
          counters: {},
        });
      }
    }

    // 削除されたプロンプトの状態をクリーンアップ
    const currentPromptIds = new Set(newConfig.prompts.map((p) => p.id));
    for (const [promptId] of this.states) {
      if (!currentPromptIds.has(promptId)) {
        this.states.delete(promptId);
      }
    }
  }
}
