/**
 * Meeting Service Adapters
 *
 * Exports all adapter-related interfaces and implementations
 */

// Phase 1: Simplified message notifier abstraction
export * from './MessageNotifier';
export * from './ChimeNotifier';
export * from './RecallNotifier';

// Phase 2: Full meeting service abstraction (for future use)
export * from './MeetingServiceAdapter';
export * from './ChimeSDKAdapter';
export * from './RecallAIAdapter';
export * from './AdapterFactory';
