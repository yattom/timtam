import React from 'react';
import { AiMessage } from './api';

interface AiAssistantPanelProps {
  aiMessages: AiMessage[];
  aiOutputRef: React.RefObject<HTMLDivElement>;
  aiOutputHeight: number;
  setAiOutputHeight: (height: number) => void;
}

export function AiAssistantPanel({
  aiMessages,
  aiOutputRef,
  aiOutputHeight,
  setAiOutputHeight,
}: AiAssistantPanelProps) {
  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = aiOutputHeight;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const newHeight = Math.max(100, Math.min(800, startHeight + deltaY));
      setAiOutputHeight(newHeight);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  return (
    <section style={{ display: 'grid', gap: 8 }} data-testid="ai-assistant-section">
      <h3>AIアシスタント</h3>
      <div style={{ position: 'relative' }}>
        <div
          ref={aiOutputRef}
          style={{
            border: '1px solid #ddd',
            borderRadius: 6,
            padding: 12,
            height: aiOutputHeight,
            background: '#f0f8ff',
            overflowY: 'auto',
            overflowX: 'hidden'
          }}
          data-testid="ai-assistant-output"
        >
          <div style={{ display: 'grid', gap: 8 }}>
            {aiMessages.map((msg, i) => {
              if (msg.type === 'llm_call') {
                // LLM呼び出しログ
                let logData: any = {};
                try {
                  logData = JSON.parse(msg.message);
                } catch {}

                // Extract and prettify content from raw response
                let contentDisplay: string = '(empty)';
                try {
                  const response = JSON.parse(logData.rawResponse);
                  const contentText = response?.content?.[0]?.text;
                  if (contentText) {
                    // Try to extract JSON from markdown code block
                    const match = contentText.match(/```json\n([\s\S]*?)\n```/);
                    if (match) {
                      const jsonContent = JSON.parse(match[1]);
                      contentDisplay = JSON.stringify(jsonContent, null, 2);
                    } else {
                      // If no code block, try to parse directly
                      try {
                        const jsonContent = JSON.parse(contentText);
                        contentDisplay = JSON.stringify(jsonContent, null, 2);
                      } catch {
                        // If not JSON, display as is
                        contentDisplay = contentText;
                      }
                    }
                  }
                } catch {}

                return (
                  <details key={msg.timestamp + '-' + i} style={{ padding: 8, background: '#fff9e6', borderRadius: 4, borderLeft: '3px solid #f39c12' }}>
                    <summary style={{ cursor: 'pointer', fontSize: 12, color: '#666', marginBottom: 4 }}>
                      🔍 LLM Call - {new Date(msg.timestamp).toLocaleTimeString('ja-JP')} - Node: {logData.nodeId || 'default'}
                    </summary>
                    <div style={{ marginTop: 8, fontSize: 13 }}>
                      <div style={{ marginBottom: 8 }}>
                        <strong>Prompt:</strong>
                        <pre style={{ whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 8, borderRadius: 4, fontSize: 12, marginTop: 4 }}>
                          {logData.prompt || '(empty)'}
                        </pre>
                      </div>
                      <div style={{ marginBottom: 8 }}>
                        <strong>Content:</strong>
                        <pre style={{ whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 8, borderRadius: 4, fontSize: 12, marginTop: 4 }}>
                          {contentDisplay}
                        </pre>
                      </div>
                      <details>
                        <summary style={{ cursor: 'pointer', fontSize: 12, color: '#888', marginBottom: 4 }}>
                          Full Raw Response (with envelope)
                        </summary>
                        <pre style={{ whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 8, borderRadius: 4, fontSize: 12, marginTop: 4 }}>
                          {logData.rawResponse || '(empty)'}
                        </pre>
                      </details>
                    </div>
                  </details>
                );
              } else {
                // AI介入メッセージ
                return (
                  <div key={msg.timestamp + '-' + i} style={{ padding: 8, background: '#e6f3ff', borderRadius: 4, borderLeft: '3px solid #2980b9' }}>
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
                      {new Date(msg.timestamp).toLocaleTimeString('ja-JP')}
                    </div>
                    <div style={{ lineHeight: 1.5 }}>{msg.message}</div>
                  </div>
                );
              }
            })}
            {aiMessages.length === 0 && (
              <div style={{ color: '#888' }}>AIアシスタントからのメッセージがここに表示される</div>
            )}
          </div>
        </div>
        <div
          onMouseDown={onResizeStart}
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: 20,
            height: 20,
            cursor: 'ns-resize',
            background: 'linear-gradient(135deg, transparent 50%, #999 50%)',
            borderBottomRightRadius: 6
          }}
        />
      </div>
    </section>
  );
}
